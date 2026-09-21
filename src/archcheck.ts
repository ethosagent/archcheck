/**
 * The facade. The composition root, and the only place the layers are wired together.
 *
 * What rule this enforces: every behaviour is reachable programmatically, because the agent hook
 * does not shell out (plan 10). The CLI is `parse args → one method here → a reporter`, and it owns
 * no behaviour of its own. If something is only possible through the CLI, this file is wrong.
 *
 * What a caller must know: `load()` returns a Result and never throws, and its failures are
 * CONFIG failures — exit 2. One module graph is built per ArchCheck instance, lazily and at most
 * once, so every probe shares a single parse.
 */
import { join } from 'node:path';
import {
  type Baseline,
  identitiesOf,
  nextBaseline,
  prunedBaseline,
  readBaseline,
  staleEntries,
  writeBaseline,
} from './baseline/index.js';
import { contractFor, validateParamsByKind, warningsFor } from './contracts/registry.js';
import type { ExplainCtx } from './contracts/types.js';
import {
  applyEmit,
  checkEmit,
  DEFAULT_GENERATED_DIR,
  type EmitPlan,
  planEmit,
} from './emit/index.js';
import type { StaleFile } from './emit/write.js';
import { applyExceptions, todayIso } from './exceptions/index.js';
import { createNodeFileSystem } from './fs/index.js';
import { readGraph } from './graph/index.js';
import type { ModuleGraph } from './graph/types.js';
import { type NormalizeInput, normalize } from './normalize/index.js';
import { createGraphProbe, GRAPH_REPORT_PATH, toGraphReport } from './probes/graph.js';
import { createLintProbe } from './probes/lint.js';
import { createModelProbe } from './probes/model/index.js';
import { createStructureProbe } from './probes/structure.js';
import { isSkip, type Probe, type RunCtx } from './probes/types.js';
import { nextIdLedger } from './registry/ids.js';
import { open, type Registry } from './registry/index.js';
import { err, ok, type Result } from './result.js';
import type { Confidence, Coverage, Diagnostic, RunResult, SkipRecord } from './types.js';
import { repoRelative } from './util/paths.js';

/** Exit codes are an API. An agent branches on them, so they are frozen from v0.1 (LLD §6). */
export const EXIT = {
  /** Clean, or only baselined and advisory findings. */
  clean: 0,
  /** New violations of error-severity rules. Fix the code. */
  violations: 1,
  /** Configuration invalid. Fix the manifest, NOT the code. */
  config: 2,
  /** Emitted output is stale. Run `archcheck emit`. */
  stale: 3,
  /** A baselined finding no longer reproduces. Run `archcheck baseline --prune` (plan 14). */
  baselineStale: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type CheckOptions = {
  /** Repo-relative POSIX paths. Undefined means the whole repository. */
  changed?: readonly string[];
  /** Run only rules at or above this confidence tier. `deterministic` skips the model tier. */
  only?: Confidence;
  /**
   * Identities the baseline records. Omitted means "read `.archcheck/baseline.json`", which is
   * what every real caller wants; pass an explicit set only to test without a file.
   */
  baselined?: ReadonlySet<string>;
  /** Override today's date. Only the expiry-boundary tests have a reason to. */
  today?: string;
  /** Ingest `.archcheck/graph.json` instead of reading the graph ourselves. */
  ingestGraph?: boolean;
  /**
   * Write `.archcheck/graph.json` as a side effect of this run. The other half of `ingestGraph`:
   * CI builds the graph once, writes it here, and every later gate ingests it rather than paying
   * for a second parse (LLD §1.3).
   */
  writeGraph?: boolean;
  cache?: boolean;
};

export type EmitResult = { written: { path: string; changed: boolean }[]; ledgerPath: string };

export type BaselineOutcome = { path: string; entries: number; removed: number };

export type ArchCheck = {
  readonly registry: Registry;
  check(options?: CheckOptions): Promise<Result<RunResult>>;
  /** `baseline --write` / `baseline --prune`. Both go through a real run first. */
  baseline(mode: 'write' | 'prune'): Promise<Result<BaselineOutcome>>;
  emit(): Result<EmitResult>;
  emitCheck(): Result<StaleFile[]>;
  /** Statement, rationale, allowed alternatives and CURRENT violations. */
  explain(ruleId: string): Promise<Result<string>>;
  coverage(): Coverage;
};

export type LoadOptions = {
  cwd?: string;
  configPath?: string;
  skipIdCheck?: boolean;
};

const TIER_RANK: Record<Confidence, number> = { deterministic: 0, proxy: 1, model: 2 };

function probes(): Probe[] {
  return [createGraphProbe(), createLintProbe(), createStructureProbe(), createModelProbe()];
}

export function load(options: LoadOptions = {}): Result<ArchCheck> {
  const opened = open({
    cwd: options.cwd,
    configPath: options.configPath,
    validateParams: validateParamsByKind,
    collectWarnings: warningsFor,
    isCheckable: (rule) => contractFor(rule.kind) !== undefined,
    skipIdCheck: options.skipIdCheck,
  });
  if (!opened.ok) return opened;
  const registry = opened.value;

  const tsconfigPath = registry.manifest.tsconfig
    ? join(registry.root, registry.manifest.tsconfig)
    : join(registry.root, 'tsconfig.json');
  const generatedDir = registry.manifest.generatedDir ?? DEFAULT_GENERATED_DIR;

  const plan = (): EmitPlan =>
    planEmit({
      root: registry.root,
      configPath: registry.configPath,
      rules: registry.all(),
      coverage: registry.coverage(),
      generatedDir,
      docs: registry.manifest.docs ?? [],
      contractFor,
    });

  const explainCtx: ExplainCtx = { rules: registry.all() };

  return ok({
    registry,

    async check(checkOptions: CheckOptions = {}): Promise<Result<RunResult>> {
      const ceiling =
        checkOptions.only === undefined ? TIER_RANK.model : TIER_RANK[checkOptions.only];
      const rules = registry.active().filter((rule) => TIER_RANK[rule.confidence] <= ceiling);

      // One graph per run, built lazily and memoised. A probe that builds its own has broken the
      // property the whole design rests on.
      let graphOnce: Result<ModuleGraph> | undefined;
      const ctx: RunCtx = {
        root: registry.root,
        tsconfigPath,
        fs: createNodeFileSystem(registry.root),
        configPath: repoRelative(registry.root, registry.configPath),
        rules,
        ...(checkOptions.changed === undefined ? {} : { changed: checkOptions.changed }),
        graph: () => {
          graphOnce ??= readGraph({
            root: registry.root,
            tsconfigPath,
            ...(checkOptions.cache === undefined ? {} : { cache: checkOptions.cache }),
          });
          return graphOnce;
        },
      };

      const inputs: NormalizeInput[] = [];
      const skipped: SkipRecord[] = [];

      if (checkOptions.writeGraph === true) {
        const graph = ctx.graph();
        if (!graph.ok) return err(graph.error);
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const reportPath = join(registry.root, GRAPH_REPORT_PATH);
        mkdirSync(join(registry.root, '.archcheck'), { recursive: true });
        writeFileSync(
          reportPath,
          `${JSON.stringify(toGraphReport(graph.value, registry.root), null, 2)}\n`,
        );
      }

      for (const probe of probes()) {
        const handled = rules.some((rule) => probe.handles.includes(rule.kind));
        if (!handled) continue;

        if (checkOptions.ingestGraph === true && probe.name === 'graph' && probe.ingest) {
          const reportPath = join(registry.root, GRAPH_REPORT_PATH);
          try {
            const { readFileSync } = await import('node:fs');
            const report: unknown = JSON.parse(readFileSync(reportPath, 'utf8'));
            inputs.push({ findings: probe.ingest(report, ctx), detectedBy: probe.name });
            continue;
          } catch (error) {
            skipped.push({
              probe: probe.name,
              reason: `cannot ingest ${GRAPH_REPORT_PATH}: ${(error as Error).message}`,
            });
            continue;
          }
        }

        const outcome = await probe.run(ctx);
        if (isSkip(outcome)) skipped.push({ probe: probe.name, reason: outcome.reason });
        else inputs.push({ findings: outcome, detectedBy: probe.name });
      }

      // A kind nobody handles is stated, never silently passed over: "declared, not checked yet"
      // is a different thing from "checked and clean", and only `skipped` can say so.
      const handledKinds = new Set(probes().flatMap((probe) => [...probe.handles]));
      for (const kind of new Set(rules.map((rule) => rule.kind))) {
        if (!handledKinds.has(kind)) {
          skipped.push({
            probe: `${kind} rules`,
            reason: 'no probe in this version handles this kind',
          });
        }
      }

      const baseline: Baseline = readBaseline(registry.root);
      const normalized = normalize(inputs, {
        byId: (id) => registry.byId(id),
        baselined: checkOptions.baselined ?? identitiesOf(baseline),
        refine: (finding, rule) => contractFor(rule.kind)?.refine?.(finding, rule, explainCtx),
      });
      if (!normalized.ok) return err(normalized.error);

      const today = checkOptions.today ?? todayIso();
      const applied = applyExceptions(registry.exceptions(), normalized.value, today);
      const diagnostics = applied.diagnostics;

      // The ratchet's second half. Scoped runs cannot judge it: a diff-scoped run evaluates a
      // fraction of the repo, so "did not reproduce" would mean "was not looked at".
      const baselineStale =
        checkOptions.changed === undefined && checkOptions.baselined === undefined
          ? staleEntries(baseline, diagnostics)
          : [];

      return ok({
        ok:
          !diagnostics.some((d) => d.severity === 'error' && !d.baselined && !d.exempted) &&
          baselineStale.length === 0 &&
          applied.expired.length === 0,
        diagnostics,
        skipped,
        coverage: registry.coverage(),
        baselineStale,
        exceptions: applied.statuses,
      });
    },

    async baseline(mode: 'write' | 'prune'): Promise<Result<BaselineOutcome>> {
      // A baseline is written from an UNBASELINED run: passing an empty set makes every current
      // violation visible, which is exactly what there is to record.
      const run = await this.check({ baselined: new Set<string>() });
      if (!run.ok) return err(run.error);

      const previous = readBaseline(registry.root);
      const next =
        mode === 'write'
          ? nextBaseline(previous, run.value.diagnostics, todayIso())
          : prunedBaseline(previous, run.value.diagnostics);
      const path = writeBaseline(registry.root, next);
      return ok({
        path,
        entries: next.entries.length,
        removed: previous.entries.length - next.entries.length,
      });
    },

    emit(): Result<EmitResult> {
      const outcome = applyEmit(plan(), nextIdLedger(registry.ledger(), registry.all()));
      return ok(outcome);
    },

    emitCheck(): Result<StaleFile[]> {
      return ok(checkEmit(plan()));
    },

    async explain(ruleId: string): Promise<Result<string>> {
      const rule = registry.byId(ruleId);
      if (!rule) {
        const known = registry
          .all()
          .map((r) => r.id)
          .sort();
        return err([`no rule '${ruleId}' in the manifest`, `  known rules: ${known.join(', ')}`]);
      }
      const contract = contractFor(rule.kind);
      const lines = [
        rule.statement,
        `  id:         ${rule.id}`,
        `  kind:       ${rule.kind}`,
        `  severity:   ${rule.severity}`,
        `  confidence: ${rule.confidence}`,
        `  remedy:     ${rule.remedy.summary}`,
      ];
      if (rule.remedy.allowed && rule.remedy.allowed.length > 0) {
        lines.push(`  allowed:    ${rule.remedy.allowed.join(', ')}`);
      }
      if (rule.remedy.docs) lines.push(`  docs:       ${rule.remedy.docs}`);
      if (rule.replaces) lines.push(`  replaces:   ${rule.replaces}`);
      if (!contract) {
        lines.push(`  note:       no probe in this version checks '${rule.kind}' rules`);
      }

      // The live count is the reason `explain` exists: it is what an agent calls when a
      // diagnostic alone was not enough to act on.
      const run = await this.check();
      lines.push(
        run.ok
          ? describeViolations(ruleId, run.value.diagnostics)
          : '  violations: unknown — the run itself failed',
      );
      if (run.ok) {
        const example = run.value.diagnostics.find((d) => d.ruleId === ruleId);
        if (example && contract) {
          lines.push('');
          lines.push(contract.explain(example, rule, explainCtx));
        }
      }
      return ok(lines.join('\n'));
    },

    coverage: () => registry.coverage(),
  });
}

/** What `explain` appends once the run has happened — the live violation count. */
export function describeViolations(ruleId: string, diagnostics: readonly Diagnostic[]): string {
  const mine = diagnostics.filter((d) => d.ruleId === ruleId);
  if (mine.length === 0) return '  violations: none right now';
  const lines = [`  violations: ${mine.length}`];
  for (const diagnostic of mine.slice(0, 10)) {
    lines.push(
      `    ${diagnostic.file}${diagnostic.line === undefined ? '' : `:${diagnostic.line}`}`,
    );
  }
  if (mine.length > 10) lines.push(`    … and ${mine.length - 10} more`);
  return lines.join('\n');
}

/**
 * The order matters. An expired exception is a MANIFEST problem (exit 2) and is checked first,
 * because the violations it stopped covering are a consequence of it rather than news of their own.
 * A stale baseline (exit 4) outranks live violations for the same reason: the fix is
 * `baseline --prune`, and reporting exit 1 would send an agent to edit code that is already right.
 */
export {
  buildInitManifest,
  inferLayers,
  initSummary,
  renderManifest,
} from './init/index.js';
export { CONFIG_FILENAME } from './registry/index.js';

export function exitCodeFor(result: RunResult): ExitCode {
  if (result.exceptions.some((exception) => exception.expired)) return EXIT.config;
  if (result.baselineStale.length > 0) return EXIT.baselineStale;
  return result.diagnostics.some((d) => d.severity === 'error' && !d.baselined && !d.exempted)
    ? EXIT.violations
    : EXIT.clean;
}

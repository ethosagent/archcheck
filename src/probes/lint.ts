/**
 * The lint probe. Evaluates `naming` and `banned-syntax` over our own program.
 *
 * Why evaluate in process at all, given we also emit lint config (plan 13)? Two reasons. The editor
 * path uses the emitted config, but CI must not need the consumer's linter installed to run
 * archcheck; and our findings carry evidence — the symbol, the module, the snippet — that a linter's
 * report cannot express, and that the identity hash needs.
 *
 * What a caller must know: `run()` needs a real program, because `banned-syntax` reads the AST.
 * `ingest()` is the other half — an external linter's report, mapped back by rule id, for the CI
 * lane that already ran one.
 */
import {
  asBannedSyntaxParams,
  bannedSyntaxApplies,
  findBannedOccurrences,
} from '../contracts/banned-syntax.js';
import { asNamingParams, nameIsWellFormed, namingApplies } from '../contracts/naming.js';
import type { Edge, ModuleGraph } from '../graph/types.js';
import type { RawFinding, Rule } from '../types.js';
import { repoRelative } from '../util/paths.js';
import type { Probe, RunCtx, Skip } from './types.js';

export const LINT_REPORT_PATH = '.archcheck/lint.json';

/** The shape an external linter's report is adapted into before it reaches us. */
export type ExternalLintReport = {
  schemaVersion: 1;
  findings: {
    ruleId: string;
    /** Repo-relative POSIX. */
    file: string;
    line?: number;
    col?: number;
    /** Whatever the linter saw. Passed through into evidence. */
    evidence?: Record<string, unknown>;
  }[];
};

function baseNameOf(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

function evaluate(ctx: RunCtx, graph: ModuleGraph): RawFinding[] {
  const namingRules = ctx.rules.filter((rule) => rule.kind === 'naming' && rule.severity !== 'off');
  const syntaxRules = ctx.rules.filter(
    (rule) => rule.kind === 'banned-syntax' && rule.severity !== 'off',
  );
  if (namingRules.length === 0 && syntaxRules.length === 0) return [];

  const changed = ctx.changed === undefined ? undefined : new Set(ctx.changed);
  const findings: RawFinding[] = [];

  const computedByFile = new Map<string, Edge[]>();
  for (const edge of graph.edges) {
    if (edge.dynamic !== 'computed') continue;
    const list = computedByFile.get(edge.from);
    if (list) list.push(edge);
    else computedByFile.set(edge.from, [edge]);
  }

  for (const file of graph.files) {
    const relative = repoRelative(ctx.root, file);
    if (changed !== undefined && !changed.has(relative)) continue;

    for (const rule of namingRules) {
      const params = asNamingParams(rule);
      if (!namingApplies(params, relative)) continue;
      const target = params.target ?? 'exports';

      if (target === 'files' || target === 'both') {
        const name = baseNameOf(relative);
        if (!nameIsWellFormed(params, name)) {
          findings.push({
            ruleId: rule.id,
            file: relative,
            evidence: { file: relative, name, namedThing: 'file' },
            identity: '',
          });
        }
      }

      if (target === 'exports' || target === 'both') {
        for (const name of graph.factsFor(file)?.exports ?? []) {
          if (nameIsWellFormed(params, name)) continue;
          findings.push({
            ruleId: rule.id,
            file: relative,
            evidence: { file: relative, name, namedThing: 'export' },
            identity: '',
          });
        }
      }
    }

    for (const rule of syntaxRules) {
      const params = asBannedSyntaxParams(rule);
      if (!bannedSyntaxApplies(params, relative)) continue;
      const occurrences = findBannedOccurrences(
        params,
        graph.sourceFileFor(file),
        computedByFile.get(file) ?? [],
        graph.checker,
      );
      for (const occurrence of occurrences) {
        findings.push({
          ruleId: rule.id,
          file: relative,
          line: occurrence.line,
          col: occurrence.col,
          // The snippet, not the line number, is what makes two occurrences distinguishable —
          // and it is stable when the file moves down the page.
          evidence: { file: relative, construct: params.selector, snippet: occurrence.snippet },
          identity: '',
        });
      }
    }
  }

  return findings;
}

export function createLintProbe(): Probe {
  return {
    name: 'lint',
    handles: ['naming', 'banned-syntax'],

    async run(ctx: RunCtx): Promise<RawFinding[] | Skip> {
      const graph = ctx.graph();
      if (!graph.ok) return { skipped: true, reason: graph.error.join('; ') };
      return evaluate(ctx, graph.value);
    },

    /** Map an external linter's report back by rule id. Anything we do not know is an error. */
    ingest(report: unknown, ctx: RunCtx): RawFinding[] {
      const parsed = report as ExternalLintReport;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.findings)) {
        throw new Error(`${LINT_REPORT_PATH} is not a lint report of schemaVersion 1`);
      }
      const known = new Set(ctx.rules.map((rule: Rule) => rule.id));
      return parsed.findings
        .filter((finding) => known.has(finding.ruleId))
        .map((finding) => ({
          ruleId: finding.ruleId,
          file: finding.file,
          ...(finding.line === undefined ? {} : { line: finding.line }),
          ...(finding.col === undefined ? {} : { col: finding.col }),
          evidence: { file: finding.file, ...(finding.evidence ?? {}) },
          identity: '',
        }));
    },
  };
}

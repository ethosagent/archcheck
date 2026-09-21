/**
 * The emit pipeline: collect → merge → write (or check).
 *
 * This is the half of the design that makes editor feedback work WITHOUT archcheck running. The
 * emitted lint message carries the rule's own sentence, so the squiggle reads
 * "domain may not import services — invert the call" rather than a rule name (LLD §1.1).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { implementedKinds } from '../contracts/index.js';
import type { ContractType, EmitCtx } from '../contracts/types.js';
import {
  RULES_JSON,
  renderRulesTable,
  replaceFencedRegion,
  rulesDocument,
} from '../coverage/index.js';
import { ID_LEDGER_PATH, type IdLedger } from '../registry/ids.js';
import type { ContractKind, Coverage, Rule } from '../types.js';
import { repoRelative } from '../util/paths.js';
import { collectFragments } from './collect.js';
import { mergeBySink, type SinkFile } from './merge.js';
import {
  checkSinks,
  type EmitTarget,
  type StaleFile,
  type WrittenFile,
  writeSinks,
} from './write.js';

export const DEFAULT_GENERATED_DIR = 'generated';

export type EmitPlan = {
  files: SinkFile[];
  unimplemented: ContractKind[];
  target: EmitTarget;
  /** Documents whose fenced region this manifest would replace. Paths are repo-relative. */
  docs: { path: string; content: string }[];
  /**
   * Documents `manifest.docs` names that could not be read. `checkEmit` reports these as
   * `unreadable` rather than dropping them: the operator named the file, so its absence is news,
   * the same way `checkSinks` reports a sink that was never generated. A document that IS there
   * and carries no fence is a different case and is left alone — `src/emit/emit.test.ts` →
   * 'a document the manifest declares' pins both halves.
   */
  unreadableDocs: string[];
};

export type PlanOptions = {
  root: string;
  configPath: string;
  rules: readonly Rule[];
  coverage: Coverage;
  generatedDir?: string;
  /** Repo-relative documents holding an `archcheck:begin rules-table` fence. */
  docs?: readonly string[];
  contractFor(kind: ContractKind): ContractType | undefined;
};

export function planEmit(options: PlanOptions): EmitPlan {
  const ctx: EmitCtx = { root: options.root, rules: options.rules };
  const { fragments, unimplemented } = collectFragments(options.rules, options.contractFor, ctx);
  const source = repoRelative(options.root, options.configPath);
  const files = mergeBySink(fragments, source);

  // rules.json is DATA, so any document — or a dashboard later — can read it without archcheck
  // knowing that document's format.
  const document = rulesDocument(options.rules, options.coverage);
  files.push({
    path: RULES_JSON,
    target: 'test',
    content: `${JSON.stringify(document, null, 2)}\n`,
    ruleIds: document.rules.map((rule) => rule.id),
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  const table = renderRulesTable(document);
  const docs: EmitPlan['docs'] = [];
  const unreadableDocs: string[] = [];
  for (const relative of options.docs ?? []) {
    const existing = readDocument(options.root, relative);
    if (existing === undefined) {
      unreadableDocs.push(relative);
      continue;
    }
    const replaced = replaceFencedRegion(existing, table);
    // No fence means the document never asked for a generated region. Not an error, and not a
    // reason to grow one by surprise.
    if (replaced !== undefined) docs.push({ path: relative, content: replaced });
  }

  return {
    files,
    unimplemented,
    target: { root: options.root, generatedDir: options.generatedDir ?? DEFAULT_GENERATED_DIR },
    docs,
    unreadableDocs,
  };
}

/**
 * What `emit` says about a rule kind it generated no configuration for.
 *
 * `emit` is its own command: a CI lane that runs only `archcheck emit` sees neither
 * `RunResult.skipped` nor `Coverage.unchecked`, so without this line a `forbidden` rule emits no
 * fragment, prints nothing, and the editor configs the rule was declared for silently lack it.
 * Same fact `collectFragments` records as `EmitPlan.unimplemented`, read from the rules alone
 * because the CLI holds no plan. `src/emit/emit.test.ts` → 'describeUnimplemented' pins it.
 */
export function describeUnimplemented(rules: readonly Rule[]): string[] {
  const implemented = new Set(implementedKinds());
  const kinds = [
    ...new Set(rules.filter((rule) => rule.severity !== 'off').map((rule) => rule.kind)),
  ]
    .filter((kind) => !implemented.has(kind))
    .sort();
  if (kinds.length === 0) return [];
  const named = kinds.map((kind) => `'${kind}'`).join(', ');
  return [
    `warning: no configuration was generated for ${named} — no contract type implements ` +
      `${kinds.length === 1 ? 'that kind' : 'those kinds'} yet`,
    '  → those rules are declared, not enforced: `archcheck` reports them under skipped',
  ];
}

function readDocument(root: string, relative: string): string | undefined {
  try {
    return readFileSync(join(root, relative), 'utf8');
  } catch {
    // Undefined means "could not read it", and whether that is news belongs to the caller:
    // `planEmit` reports a document the manifest named, `applyEmit` and `checkEmit` treat an
    // unreadable file as "differs from what we would write".
    return undefined;
  }
}

export type EmitOutcome = { written: WrittenFile[]; ledgerPath: string };

/** Writes the sinks, and the id ledger that makes rule ids immutable. */
export function applyEmit(plan: EmitPlan, ledger: IdLedger): EmitOutcome {
  const written = writeSinks(plan.target, plan.files);

  for (const doc of plan.docs) {
    const path = join(plan.target.root, doc.path);
    const current = readDocument(plan.target.root, doc.path);
    if (current === doc.content) {
      written.push({ path: doc.path, changed: false });
      continue;
    }
    writeFileSync(path, doc.content);
    written.push({ path: doc.path, changed: true });
  }
  const ledgerPath = join(plan.target.root, ID_LEDGER_PATH);
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, content);
  return { written, ledgerPath: ID_LEDGER_PATH };
}

export function checkEmit(plan: EmitPlan): StaleFile[] {
  const stale = checkSinks(plan.target, plan.files);
  for (const path of plan.unreadableDocs) stale.push({ path, reason: 'unreadable' });
  for (const doc of plan.docs) {
    // Hand-editing inside the fence is the failure this catches: the region is generated, so a
    // human edit there is lost on the next emit and disagrees with the manifest until then.
    if (readDocument(plan.target.root, doc.path) !== doc.content) {
      stale.push({ path: doc.path, reason: 'hand-edited' });
    }
  }
  return stale;
}

export { type CollectResult, collectFragments } from './collect.js';
export { commentHeader, type GeneratedMeta, generatedMeta, REGENERATE_COMMAND } from './header.js';
export { mergeBySink, SINK_PATHS, type SinkFile, sortDeep } from './merge.js';
export {
  checkSinks,
  describeStale,
  type EmitTarget,
  type StaleFile,
  type WrittenFile,
  writeSinks,
} from './write.js';

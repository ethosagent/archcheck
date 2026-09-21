/**
 * The emit pipeline: collect → merge → write (or check).
 *
 * This is the half of the design that makes editor feedback work WITHOUT archcheck running. The
 * emitted lint message carries the rule's own sentence, so the squiggle reads
 * "domain may not import services — invert the call" rather than a rule name (LLD §1.1).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContractType, EmitCtx } from '../contracts/types.js';
import { ID_LEDGER_PATH, type IdLedger } from '../registry/ids.js';
import type { ContractKind, Rule } from '../types.js';
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
};

export type PlanOptions = {
  root: string;
  configPath: string;
  rules: readonly Rule[];
  generatedDir?: string;
  contractFor(kind: ContractKind): ContractType | undefined;
};

export function planEmit(options: PlanOptions): EmitPlan {
  const ctx: EmitCtx = { root: options.root, rules: options.rules };
  const { fragments, unimplemented } = collectFragments(options.rules, options.contractFor, ctx);
  const source = repoRelative(options.root, options.configPath);
  return {
    files: mergeBySink(fragments, source),
    unimplemented,
    target: { root: options.root, generatedDir: options.generatedDir ?? DEFAULT_GENERATED_DIR },
  };
}

export type EmitOutcome = { written: WrittenFile[]; ledgerPath: string };

/** Writes the sinks, and the id ledger that makes rule ids immutable. */
export function applyEmit(plan: EmitPlan, ledger: IdLedger): EmitOutcome {
  const written = writeSinks(plan.target, plan.files);
  const ledgerPath = join(plan.target.root, ID_LEDGER_PATH);
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, content);
  return { written, ledgerPath: ID_LEDGER_PATH };
}

export function checkEmit(plan: EmitPlan): StaleFile[] {
  return checkSinks(plan.target, plan.files);
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

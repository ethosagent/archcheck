/**
 * The second seam: a probe.
 *
 * What rule this enforces: every probe can either RUN a tool or INGEST the report another gate
 * already produced (LLD §1.3). Without that, archcheck re-runs the type checker, the linter and
 * the graph reader and doubles CI time for no new information. CI builds each artefact once and
 * archcheck normalises; running directly is the local convenience path.
 *
 * What a caller must know: `ctx.graph()` is MEMOISED by the caller. One parse, shared by every
 * probe — a probe that builds its own graph has broken the property the whole design rests on.
 */

import type { ModuleGraph } from '../graph/types.js';
import type { Result } from '../result.js';
import type { ContractKind, RawFinding, Rule } from '../types.js';

/** A probe that could not run. `skipped` in the RunResult is built from these. */
export type Skip = { skipped: true; reason: string };

export function isSkip(value: unknown): value is Skip {
  return typeof value === 'object' && value !== null && (value as Skip).skipped === true;
}

export type RunCtx = {
  root: string;
  tsconfigPath: string;
  /** Active rules only — `severity: 'off'` never reaches a probe. */
  rules: readonly Rule[];
  /**
   * Repo-relative POSIX paths of the changed set, or undefined for the whole repository.
   * Diff scoping is where the real saving is: rule evaluation and every model call (LLD §1.8).
   */
  changed?: readonly string[];
  /** The shared module graph, built at most once per run. */
  graph(): Result<ModuleGraph>;
};

export type Probe = {
  name: string;
  handles: readonly ContractKind[];
  run(ctx: RunCtx): Promise<RawFinding[] | Skip>;
  /** Map a report another gate wrote back into findings. */
  ingest?(report: unknown, ctx: RunCtx): RawFinding[];
};

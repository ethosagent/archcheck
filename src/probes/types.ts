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

import type { FileSystem } from '../fs/index.js';
import type { ModuleGraph } from '../graph/types.js';
import type { Result } from '../result.js';
import type { ContractKind, RawFinding, Rule } from '../types.js';

/**
 * Why a probe runs. A probe normally runs because an active rule has a kind it handles, which is
 * what `handles` says. `appliesTo` exists for the other reason: a rule-level FIELD, which has no
 * kind to dispatch on — `coveredBy` is on any rule, of any kind. A probe that does not set it
 * keeps the `handles` behaviour exactly.
 */
export type ProbeApplies = (rules: readonly Rule[]) => boolean;

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
  /** Every filesystem read goes through here, so a probe can be run with no disk at all. */
  fs: FileSystem;
  /** Repo-relative path of the manifest — where a registry-level finding is reported against. */
  configPath: string;
  /**
   * Globs naming the test files. Manifest configuration, so it is NOT stored on the cached graph:
   * a flag derived from the manifest would go stale the moment somebody edited the globs, with
   * nothing to notice.
   */
  tests: readonly string[];
};

export type Probe = {
  name: string;
  handles: readonly ContractKind[];
  /** Run for a reason other than a kind. Defaults to the `handles` check. */
  appliesTo?: ProbeApplies;
  run(ctx: RunCtx): Promise<RawFinding[] | Skip>;
  /** Map a report another gate wrote back into findings. */
  ingest?(report: unknown, ctx: RunCtx): RawFinding[];
};

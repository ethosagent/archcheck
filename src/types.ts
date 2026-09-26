/**
 * The five types. Everything else in archcheck is a function between them (LLD §2).
 *
 * What this is for: the shared kernel. Every layer reads these; this module reads nothing —
 * not another archcheck module, and not the TypeScript SDK. That is deliberate and enforced by
 * archcheck's own `kernel` layer, whose `mayImport` list is empty.
 *
 * What a caller must know: two fields are computed, never supplied. `identity` is the
 * normaliser's job (a probe that invents one is wrong), and `schemaVersion` is stamped by
 * construction. See `src/normalize/`.
 */
import type { SchemaVersion } from './version.js';

/** The closed set of eight. Adding a ninth is a design decision, not a task (LLD §4). */
export type ContractKind =
  | 'layers'
  | 'forbidden'
  | 'encapsulation'
  | 'naming'
  | 'required-file'
  | 'declared-field'
  | 'banned-syntax'
  | 'judgement';

export const CONTRACT_KINDS: readonly ContractKind[] = [
  'layers',
  'forbidden',
  'encapsulation',
  'naming',
  'required-file',
  'declared-field',
  'banned-syntax',
  'judgement',
] as const;

export type Severity = 'error' | 'warn' | 'advisory' | 'off';

/**
 * Severity and confidence are orthogonal. A `model` rule can be `error` in principle — that is
 * policy, not a type constraint. The default is what stops it; the type does not (plan 02).
 */
export type Confidence = 'deterministic' | 'proxy' | 'model';

export type Remedy = {
  /** One imperative sentence. Goes into the emitted lint message beside the statement. */
  summary: string;
  allowed?: string[];
  autofix?: boolean;
  docs?: string;
};

/** What the consumer writes, one entry per rule in `architecture.config.ts`. */
export type Rule = {
  /** Immutable once committed. Renaming means a new id plus `replaces` (LLD §1.6). */
  id: string;
  kind: ContractKind;
  /** One sentence. This is the text that ends up in the editor squiggle. */
  statement: string;
  severity: Severity;
  confidence: Confidence;
  /** Kind-specific, validated by the kind's `validate()`. Never read without validating. */
  params: Record<string, unknown>;
  remedy: Remedy;
  /** Set when this rule supersedes a retired id. */
  replaces?: string;
  /** Required on an exception (plan 15). */
  owner?: string;
  expires?: string;
};

/** What a probe returns, before enrichment. Evidence, never prose. */
export type RawFinding = {
  ruleId: string;
  /** Repo-relative POSIX path. */
  file: string;
  line?: number;
  col?: number;
  endLine?: number;
  /** The semantic facts: `{ from, to }` for a graph edge, `{ symbol }` for a naming miss. */
  evidence: Record<string, unknown>;
  /**
   * Stable hash — survives line moves. Computed by the normaliser from ruleId + evidence.
   * A probe leaves this empty; `normalize()` fills it.
   */
  identity: string;
};

/**
 * What everything downstream consumes. Diagnostic *extends* RawFinding: the normaliser only
 * adds, it never rewrites what a probe observed, which keeps probe output auditable against
 * the diagnostic a person finally reads (plan 02).
 */
export type Diagnostic = RawFinding & {
  schemaVersion: SchemaVersion;
  statement: string;
  severity: Severity;
  confidence: Confidence;
  remedy: Remedy;
  /**
   * The probes that observed this. A list rather than the LLD's single string, because
   * deduplication by identity legitimately collapses two observations of one violation —
   * the graph sees the edge, lint sees the statement — and losing the second is losing
   * evidence (plan 07).
   */
  detectedBy: string[];
  /**
   * How many raw findings collapsed into this one identity — normally 1. Evidence carries no
   * position by design, so two empty catches in one file are literally the same evidence and the
   * same hash (`computeIdentity`, src/normalize/identity.ts); this count is what keeps "one
   * diagnostic" from being read as "one violation". It lives HERE and not in `evidence` precisely
   * so the hash is untouched — pinned by 'counting occurrences leaves the identity hash alone' in
   * src/normalize/normalize.test.ts.
   *
   * Optional because a required field would break every existing producer of the agent contract.
   * Absent means 1; `normalize()` always sets it.
   */
  occurrences?: number;
  /** Where those occurrences are, sorted and de-duplicated. Only the lines a probe reported. */
  occurrenceLines?: number[];
  /** Recorded in the baseline as pre-existing debt. Debt, not policy — see `exempted`. */
  baselined: boolean;
  /**
   * Covered by a declared exception: owned, reasoned and expiring. Kept separate from `baselined`
   * on purpose. A baseline entry is debt nobody has signed for; an exception is a deliberate
   * permanent allowance somebody has. Conflating them is how debt quietly becomes policy
   * (plan 14).
   */
  exempted: boolean;
};

/**
 * One recorded pre-existing violation. KEYED by identity, never by line — but it also records how
 * many occurrences that identity stood for, because one identity can cover several violations of
 * one rule in one file (see `Diagnostic.occurrences`). Without the count, a single entry would
 * suppress every later occurrence in that file for ever.
 *
 * An entry written before this field existed reads as 1, filled in by `readBaseline`
 * (src/baseline/index.ts), so no existing baseline file is invalidated.
 */
export type BaselineEntry = {
  identity: string;
  ruleId: string;
  /** ISO date. For auditing how long a piece of debt has been carried. */
  addedAt: string;
  /** How many occurrences this identity covered when it was recorded. At least 1. */
  occurrences: number;
  note?: string;
};

/** A declared allowance, as the run sees it once today's date is known. */
export type ExceptionStatus = {
  ruleId: string;
  /**
   * The path glob(s) it covers, exactly as the manifest wrote them. Absent for an exception pinned
   * by `identity` alone. Without it a consumer cannot tell which file an exception covers short of
   * parsing the prose reason. Copied by `applyExceptions` (src/exceptions/index.ts).
   */
  path?: string | string[];
  owner: string;
  expires: string;
  expired: boolean;
  /** Negative once expired. */
  daysLeft: number;
  reason: string;
  /** How many findings it actually suppressed this run. Zero means it is doing nothing. */
  suppressed: number;
};

/** Emitted config, grouped by sink. One rule may produce several (LLD §1.2). */
export type FragmentTarget = 'graph' | 'lint' | 'boundaries' | 'test' | 'exports';

export type Fragment = {
  target: FragmentTarget;
  /** The rule that produced it — the generated header names them all. */
  ruleId: string;
  content: unknown;
};

export type Coverage = {
  total: number;
  deterministic: number;
  proxy: number;
  model: number;
  /**
   * Rules whose KIND no version of archcheck checks yet. Counted apart from the three tiers on
   * purpose: the tier a rule declares is a claim by its author, and for an unimplemented kind
   * archcheck knows that claim is wrong whatever the manifest says. Folding these into
   * `deterministic` would inflate the one number nobody is supposed to be able to inflate.
   */
  unchecked: number;
};

/** A probe that did not run. Present even when empty: "clean" must be distinguishable. */
export type SkipRecord = { probe: string; reason: string };

export type RunResult = {
  ok: boolean;
  diagnostics: Diagnostic[];
  skipped: SkipRecord[];
  coverage: Coverage;
  /**
   * Baseline entries that no longer reproduce. The ratchet turns ONE WAY: a fixed violation that
   * is still listed exits 4, because a baseline that only ever grows silently over-suppresses
   * forever — the failure mode that makes baselines worthless wherever they are used badly.
   */
  baselineStale: BaselineEntry[];
  /**
   * Every declared exception, always — including the ones suppressing nothing. A silent exception
   * decays into a permanent one (plan 15).
   */
  exceptions: ExceptionStatus[];
};

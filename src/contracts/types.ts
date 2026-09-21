/**
 * The first seam: a contract kind.
 *
 * What a caller must know: `validate` takes a context the LLD's signature did not, because one
 * question genuinely needs it — "does this layer's mayImport name a layer that exists?" cannot be
 * answered from one rule in isolation, and it is the single most common manifest typo. Everything
 * else about the seam is unchanged.
 *
 * Adding a ninth kind is a design decision, not a task: every kind costs a validator, an emitter,
 * an explainer and a fixture that must fail (LLD §4).
 */
import type { Result } from '../result.js';
import type { ContractKind, Fragment, RawFinding, Remedy, Rule } from '../types.js';

export type ValidateCtx = {
  /** Every rule in the manifest — a kind whose meaning depends on the set can see the set. */
  rules: readonly Rule[];
};

export type EmitCtx = {
  root: string;
  rules: readonly Rule[];
};

/**
 * Explaining needs the rule set for the same reason validating does: a sentence like "domain may
 * import: contracts, rules" is a fact about the manifest, not about the violation. Keeping it out
 * of `evidence` is not cosmetic — evidence feeds the identity hash, so a rule's allow-list growing
 * an unrelated entry would otherwise silently invalidate every baseline entry it touches.
 */
export type ExplainCtx = {
  rules: readonly Rule[];
};

/**
 * A per-finding sharpening of the rule's own words.
 *
 * Why this exists: one rule legitimately covers findings that need different sentences. A `layers`
 * rule states "domain may import only contracts and rules", but an UNLAYERED file broke no
 * allow-list — it matched no layer at all, and telling its author to "invert the call" sends them
 * to the wrong fix. The rule's statement is what the editor squiggle shows (it is per-rule); this
 * is what a diagnostic shows (it is per-finding).
 */
export type Refinement = { statement?: string; remedy?: Remedy };

export type ContractType = {
  kind: ContractKind;
  /** Params well-formed? Returns every problem, never throws (a bad manifest exits 2). */
  validate(rule: Rule, ctx: ValidateCtx): Result<void>;
  /** One rule → many sinks. The merger groups fragments by target (LLD §1.2). */
  emit(rule: Rule, ctx: EmitCtx): Fragment[];
  /** Finding → the sentence a person reads. Returns the remedy, not the symptom. */
  explain(finding: RawFinding, rule: Rule, ctx: ExplainCtx): string;
  /** Optional: sharpen the statement or remedy for one finding. See Refinement. */
  refine?(finding: RawFinding, rule: Rule, ctx: ExplainCtx): Refinement | undefined;
};

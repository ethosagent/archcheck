/**
 * kind → ContractType.
 *
 * What a caller must know: a kind in the closed set of eight that has no entry here is not a
 * config error. It validates, it counts toward coverage, and the run records a skip saying no
 * probe handles it. That is deliberate: rejecting a `judgement` rule on a version that has not
 * shipped the model probe would force a consumer to delete rules in order to upgrade, and the
 * honest report is "declared, not checked yet" — which is exactly what `skipped` is for.
 */
import { ok, type Result } from '../result.js';
import type { ContractKind, Rule } from '../types.js';
import { bannedSyntaxContract } from './banned-syntax.js';
import { declaredFieldContract } from './declared-field.js';
import { encapsulationContract } from './encapsulation.js';
import { forbiddenContract } from './forbidden.js';
import { judgementContract } from './judgement.js';
import { layersContract } from './layers.js';
import { namingContract } from './naming.js';
import { requiredFileContract } from './required-file.js';
import type { ContractType, ValidateCtx } from './types.js';

const IMPLEMENTED: readonly ContractType[] = [
  layersContract,
  forbiddenContract,
  encapsulationContract,
  namingContract,
  bannedSyntaxContract,
  requiredFileContract,
  declaredFieldContract,
  judgementContract,
];

const byKind = new Map<ContractKind, ContractType>(IMPLEMENTED.map((c) => [c.kind, c]));

export function contractFor(kind: ContractKind): ContractType | undefined {
  return byKind.get(kind);
}

export function implementedKinds(): readonly ContractKind[] {
  return IMPLEMENTED.map((contract) => contract.kind);
}

/**
 * The ParamsValidator the registry needs, wired to the kinds. Injected by the facade, which is the
 * only place that knows both halves — the registry knows a rule has a kind, and only a kind knows
 * what its params mean.
 */
export function validateParamsByKind(rule: Rule, rules: readonly Rule[]): Result<void> {
  const ctx: ValidateCtx = { rules };
  return contractFor(rule.kind)?.validate(rule, ctx) ?? ok(undefined);
}

/** Things that load fine but somebody should see. Printed by the CLI, never silently dropped. */
export function warningsFor(rules: readonly Rule[]): string[] {
  const ctx: ValidateCtx = { rules };
  return rules.flatMap((rule) => contractFor(rule.kind)?.warn?.(rule, ctx) ?? []);
}

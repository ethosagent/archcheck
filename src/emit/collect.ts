/**
 * Fragment collection across every rule.
 *
 * What rule this enforces: one rule may need several configs (LLD §1.2) — `encapsulation` needs a
 * package exports map AND a graph rule, `layers` needs a graph rule AND a lint rule whose message
 * carries the statement. So `emit()` returns an array and the merger groups by sink.
 *
 * What a caller must know: rules are visited in id order. Determinism starts here, not in the
 * writer — a re-emit with an unchanged manifest must be byte-identical or `emit --check` becomes a
 * false-alarm generator and gets switched off.
 */
import type { ContractType, EmitCtx } from '../contracts/types.js';
import type { ContractKind, Fragment, Rule } from '../types.js';

export type CollectResult = {
  fragments: Fragment[];
  /** Kinds declared in the manifest that no contract type implements yet. */
  unimplemented: ContractKind[];
};

export function collectFragments(
  rules: readonly Rule[],
  contractFor: (kind: ContractKind) => ContractType | undefined,
  ctx: EmitCtx,
): CollectResult {
  const sorted = [...rules]
    .filter((rule) => rule.severity !== 'off')
    .sort((a, b) => a.id.localeCompare(b.id));
  const fragments: Fragment[] = [];
  const unimplemented = new Set<ContractKind>();

  for (const rule of sorted) {
    const contract = contractFor(rule.kind);
    if (!contract) {
      unimplemented.add(rule.kind);
      continue;
    }
    fragments.push(...contract.emit(rule, ctx));
  }

  return { fragments, unimplemented: [...unimplemented].sort() };
}

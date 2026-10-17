import type { Rule } from '../types.js';

// A manifest naming no dimension has exactly one, so it behaves as it always did.
export const DEFAULT_DIMENSION = 'layer';

// Returns the rule's dimension or the default.
export function dimensionOf(rule: Rule): string {
  const declared = (rule.params as { dimension?: unknown }).dimension;
  return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_DIMENSION;
}

// Groups active layers rules by dimension, default first.
export function dimensionsOf(rules: readonly Rule[]): string[] {
  const found: string[] = [];

  for (const rule of rules) {
    if (rule.kind !== 'layers' || rule.severity === 'off') continue;
    const dimension = dimensionOf(rule);
    if (found.includes(dimension)) continue;
    found.push(dimension);
  }

  if (!found.includes(DEFAULT_DIMENSION)) return found;
  return [DEFAULT_DIMENSION, ...found.filter((name) => name !== DEFAULT_DIMENSION)];
}

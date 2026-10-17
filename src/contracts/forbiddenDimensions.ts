/**
 * Classifies keys on a forbidden-rule side as reserved or dimension names.
 * Callers must pass `declared` to dimensionProblems so unknown dimensions are caught.
 */

export const RESERVED_SIDE_KEYS = ['glob', 'except', 'package'];

export type SideLike = Readonly<Record<string, unknown>>;

export type LayerNames = Readonly<Record<string, string | undefined>>;

export function dimensionsOfSide(side: SideLike): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(side)) {
    if (RESERVED_SIDE_KEYS.includes(key)) continue;
    result[key] = side[key];
  }
  return result;
}

export function sideDimensionsMatch(side: SideLike, layers: LayerNames): boolean {
  for (const [dimension, value] of Object.entries(dimensionsOfSide(side))) {
    if (typeof value !== 'string') return false;
    if (layers[dimension] !== value) return false;
  }
  return true;
}

export function dimensionProblems(side: SideLike, declared: readonly string[]): string[] {
  const problems: string[] = [];
  const known = declared.length > 0 ? [...declared].sort().join(', ') : 'none';
  for (const [dimension, value] of Object.entries(dimensionsOfSide(side))) {
    if (typeof value !== 'string') {
      problems.push(
        `declares dimension '${dimension}' as a non-string, so it can never match a layer name`,
      );
      continue;
    }
    if (!declared.includes(dimension)) {
      problems.push(`names an unknown dimension '${dimension}' — declared dimensions are ${known}`);
    }
  }
  return problems;
}

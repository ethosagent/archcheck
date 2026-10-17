import { expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import { DEFAULT_DIMENSION, dimensionOf, dimensionsOf } from './dimensions.js';

function layer(id: string, params: Record<string, unknown> = {}): Rule {
  return {
    id,
    kind: 'layers',
    statement: 'a layer holds',
    severity: 'error',
    confidence: 'deterministic',
    params: { name: id, match: 'src/**', mayImport: [], ...params },
    remedy: { summary: 'fix it' },
  };
}

test('a rule without a dimension falls back to the default', () => {
  expect(DEFAULT_DIMENSION).toBe('layer');
  expect(dimensionOf(layer('a'))).toBe('layer');
  expect(dimensionOf(layer('a', { dimension: 'runtime' }))).toBe('runtime');
});

test('each dimension appears once, with the default first', () => {
  const mixed = [layer('a', { dimension: 'runtime' }), layer('b')];
  const runtimeOnly = [layer('a', { dimension: 'runtime' })];
  const twiceRuntime = [layer('a', { dimension: 'runtime' }), layer('b', { dimension: 'runtime' })];

  expect(dimensionsOf([layer('a'), layer('b')])).toEqual(['layer']);
  expect(dimensionsOf(mixed)).toEqual(['layer', 'runtime']);
  expect(dimensionsOf(runtimeOnly)).toEqual(['runtime']);
  expect(dimensionsOf(twiceRuntime)).toEqual(['runtime']);
});

test('an off rule and another kind are both ignored', () => {
  const off = { ...layer('a', { dimension: 'runtime' }), severity: 'off' as const };
  const other = { ...layer('b'), kind: 'naming' as const };

  expect(dimensionsOf([off])).toEqual([]);
  expect(dimensionsOf([other])).toEqual([]);
});

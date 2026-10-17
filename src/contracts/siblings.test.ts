import { expect, test } from 'bun:test';
import { resolveSiblingEdge, unitOf } from './siblings.js';

const unit = 'src/features/*';

test('unitOf finds the unit a nested file belongs to, and undefined outside every unit', () => {
  expect(unitOf(unit, 'src/features/cart/a.ts')).toBe('src/features/cart');
  expect(unitOf(unit, 'src/shared/a.ts')).toBeUndefined();
  expect(unitOf(unit, 'src/features/cart')).toBeUndefined();
});

test('resolveSiblingEdge denies a cross-unit edge and names both units', () => {
  const verdict = resolveSiblingEdge(
    unit,
    'deny',
    'src/features/cart/a.ts',
    'src/features/checkout/b.ts',
  );
  expect(verdict.denied).toBe(true);
  if (verdict.denied) {
    expect(verdict.fromUnit).toBe('src/features/cart');
    expect(verdict.toUnit).toBe('src/features/checkout');
  }
});

test('allow, a same-unit edge, and a target outside every unit are all permitted', () => {
  const allowed = resolveSiblingEdge(
    unit,
    'allow',
    'src/features/cart/a.ts',
    'src/features/checkout/b.ts',
  );
  const sameUnit = resolveSiblingEdge(
    unit,
    'deny',
    'src/features/cart/a.ts',
    'src/features/cart/b.ts',
  );
  const outside = resolveSiblingEdge(unit, 'deny', 'src/features/cart/a.ts', 'src/shared/b.ts');

  expect(allowed.denied).toBe(false);
  expect(sameUnit.denied).toBe(false);
  expect(outside.denied).toBe(false);
});

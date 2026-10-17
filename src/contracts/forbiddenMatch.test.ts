import { expect, test } from 'bun:test';
import { sideMatches, targetMatches } from './forbiddenMatch.js';

const inside = (path: string, layer: string) => ({ path, layer, external: false });
const outside = (path: string) => ({ path, layer: undefined, external: true });

test('a side matches on layer, on glob, or on both together', () => {
  expect(sideMatches({ layer: 'checkout' }, inside('src/checkout/a.ts', 'checkout'))).toBe(true);
  expect(sideMatches({ layer: 'checkout' }, inside('src/cart/a.ts', 'cart'))).toBe(false);
  expect(sideMatches({ glob: 'src/checkout/**' }, inside('src/checkout/a.ts', 'any'))).toBe(true);
  expect(sideMatches({ glob: 'src/cart/**' }, inside('src/checkout/a.ts', 'any'))).toBe(false);
});

test('except beats a glob that would otherwise match', () => {
  const side = { glob: 'src/checkout/**', except: 'src/checkout/legacy/**' };
  expect(sideMatches(side, inside('src/checkout/legacy/a.ts', 'checkout'))).toBe(false);
  expect(sideMatches(side, inside('src/checkout/a.ts', 'checkout'))).toBe(true);
});

test('a package ban reads an external edge and a path ban reads an internal one', () => {
  expect(targetMatches({ package: 'lodash/*' }, outside('lodash/fp'))).toBe(true);
  expect(targetMatches({ package: 'lodash/*' }, outside('react'))).toBe(false);
  expect(targetMatches({ package: 'lodash/*' }, inside('src/a.ts', 'any'))).toBe(false);
  expect(targetMatches({ layer: 'payments' }, outside('lodash'))).toBe(false);
});

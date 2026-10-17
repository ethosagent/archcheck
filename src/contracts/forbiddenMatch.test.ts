import { expect, test } from 'bun:test';
import { sideMatches, targetMatches } from './forbiddenMatch.js';

const inside = (path: string, layer: string, more: Record<string, string> = {}) => ({
  path,
  external: false,
  layers: { layer, ...more },
});
const outside = (path: string) => ({ path, external: true, layers: {} });

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

test('a side can name a second dimension, and both axes have to agree', () => {
  const client = inside('src/ui/a.ts', 'ui', { runtime: 'client' });
  const server = inside('src/api/a.ts', 'api', { runtime: 'server' });
  expect(sideMatches({ runtime: 'client' }, client)).toBe(true);
  expect(sideMatches({ runtime: 'client' }, server)).toBe(false);
  // Both keys are dimensions, so both are read, and one disagreement is enough.
  expect(sideMatches({ layer: 'ui', runtime: 'client' }, client)).toBe(true);
  expect(sideMatches({ layer: 'ui', runtime: 'server' }, client)).toBe(false);
});

test('a dimension no edge end carries matches nothing, rather than everything', () => {
  // The quiet failure this guards: a rule naming an axis the manifest does not declare must ban
  // no edge, not every edge.
  expect(sideMatches({ zone: 'inner' }, inside('src/ui/a.ts', 'ui'))).toBe(false);
});

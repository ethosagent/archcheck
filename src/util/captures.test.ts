import { expect, test } from 'bun:test';
import { captureNames, captureProblems, capturesOf, toGlob } from './captures.js';

const pattern = 'src/modules/{module}/domain/**';

test('the brace names are read in order, and toGlob replaces each one', () => {
  expect(captureNames(pattern)).toEqual(['module']);
  expect(captureNames('src/**')).toEqual([]);
  expect(toGlob(pattern)).toBe('src/modules/*/domain/**');
});

test('a capture reads the segment at its own index', () => {
  expect(capturesOf(pattern, 'src/modules/billing/domain/a.ts')).toEqual({ module: 'billing' });
  expect(capturesOf(pattern, 'src')).toBeUndefined();
  expect(capturesOf('src/**', 'src/a.ts')).toEqual({});
});

test('captureProblems names an unstable index and a repeat', () => {
  expect(captureProblems('src/**/{module}/x')).toHaveLength(1);
  expect(captureProblems('a/{x}/b/{x}')).toHaveLength(1);
  expect(captureProblems(pattern)).toEqual([]);
  expect(captureProblems('a/{x}/b/{y}')).toEqual([]);
});

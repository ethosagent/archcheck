import { expect, test } from 'bun:test';
import { DEFAULT_TEST_GLOBS, edgeInScope, isTestFile } from './testEdges.js';

test('the default globs recognise the four conventions, and reject plain source', () => {
  expect(isTestFile(DEFAULT_TEST_GLOBS, 'src/a.test.ts')).toBe(true);
  expect(isTestFile(DEFAULT_TEST_GLOBS, 'src/a.spec.ts')).toBe(true);
  expect(isTestFile(DEFAULT_TEST_GLOBS, 'src/__tests__/a.ts')).toBe(true);
  expect(isTestFile(DEFAULT_TEST_GLOBS, 'src/__mocks__/fs.ts')).toBe(true);
  expect(isTestFile(DEFAULT_TEST_GLOBS, 'src/a.ts')).toBe(false);
});

test('a custom list replaces the defaults rather than adding to them', () => {
  expect(isTestFile(['test/**'], 'test/helpers/x.ts')).toBe(true);
  expect(isTestFile(['test/**'], 'src/a.test.ts')).toBe(false);
});

test('edgeInScope skips a test edge only under the production filter', () => {
  expect(edgeInScope('all', true)).toBe(true);
  expect(edgeInScope('all', false)).toBe(true);
  expect(edgeInScope('production', false)).toBe(true);
  expect(edgeInScope('production', true)).toBe(false);
});

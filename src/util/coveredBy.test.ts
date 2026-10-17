import { expect, test } from 'bun:test';
import type { CoveredBy, Rule } from '../types.js';
import { coveredByProblems, declaresTest, hasCoveredBy } from './coveredBy.js';

function rule(coveredBy?: CoveredBy): Rule {
  const base = {
    id: 'r',
    kind: 'layers',
    statement: 's',
    severity: 'error',
    confidence: 'proxy',
    params: {},
    remedy: { summary: 'x' },
  };
  return { ...base, ...(coveredBy === undefined ? {} : { coveredBy }) } as unknown as Rule;
}

test('hasCoveredBy needs a coveredBy with at least one test glob', () => {
  expect(hasCoveredBy(rule())).toBe(false);
  expect(hasCoveredBy(rule({ tests: [] }))).toBe(false);
  expect(hasCoveredBy(rule({ tests: ['src/a/**.test.ts'] }))).toBe(true);
});

test('coveredByProblems names each structural fault', () => {
  expect(coveredByProblems(undefined)).toEqual([]);
  expect(coveredByProblems(42)[0]).toContain('must be an object');
  expect(coveredByProblems({})[0]).toContain('at least one glob');
  expect(coveredByProblems({ tests: [''] })[0]).toContain('non-empty globs');
  expect(coveredByProblems({ tests: ['a'], name: 42 })[0]).toContain('name must be');
});

test('declaresTest matches a quoted title and rejects an unquoted mention', () => {
  expect(declaresTest("test('storage contract')", 'storage contract')).toBe(true);
  expect(declaresTest('test("storage contract")', 'storage contract')).toBe(true);
  expect(declaresTest('const storage contract = 1', 'storage contract')).toBe(false);
});

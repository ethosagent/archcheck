import type { Rule } from '../types.js';

// True when the rule declares a coveredBy with at least one test glob.
export function hasCoveredBy(rule: Rule): boolean {
  const coveredBy = rule.coveredBy;
  return coveredBy !== undefined && coveredBy.tests.length > 0;
}

// Structural problems in a coveredBy, empty when it is sound or absent.
export function coveredByProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null) {
    return ['must be an object with a list of test globs'];
  }

  const { tests, name } = value as { tests?: unknown; name?: unknown };
  const problems: string[] = [];

  if (!Array.isArray(tests) || tests.length === 0) {
    problems.push('must have a tests list with at least one glob');
  } else if (tests.some((t) => typeof t !== 'string' || t === '')) {
    problems.push('tests must be a list of non-empty globs');
  }

  if (name !== undefined && (typeof name !== 'string' || name === '')) {
    problems.push('name must be a non-empty string when given');
  }

  return problems;
}

// True when the text contains the name at the start of a quoted string.
export function declaresTest(source: string, name: string): boolean {
  const candidates = [`'${name}`, `"${name}`, `\`${name}`];
  return candidates.some((candidate) => source.includes(candidate));
}

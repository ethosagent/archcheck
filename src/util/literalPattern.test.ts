import { expect, test } from 'bun:test';
import { matchesPattern, patternProblems } from './literalPattern.js';

const url = '^https?://';

test('a sound pattern has no problems', () => {
  expect(patternProblems(url)).toEqual([]);
});

test('a non-string, an empty string and a broken pattern are each reported', () => {
  expect(patternProblems(42)[0]).toContain('must be a string');
  expect(patternProblems('')[0]).toContain('must not be empty');
  expect(patternProblems('[')[0]).toContain('not a valid regular expression');
});

test('matchesPattern tests text, and a broken pattern is false rather than a throw', () => {
  expect(matchesPattern(url, 'https://example.com')).toBe(true);
  expect(matchesPattern(url, 'not a url')).toBe(false);
  expect(matchesPattern('[', 'anything')).toBe(false);
});

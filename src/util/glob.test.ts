import { describe, expect, test } from 'bun:test';
import { globProblems, matches, matchesAny } from './glob.js';

describe('glob', () => {
  test('* does not cross a slash', () => {
    expect(matches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matches('src/*.ts', 'src/nested/a.ts')).toBe(false);
  });

  test('** crosses slashes', () => {
    expect(matches('src/**', 'src/a/b/c.ts')).toBe(true);
    expect(matches('modules/*/rules/**', 'modules/ledger/rules/grounded.ts')).toBe(true);
    expect(matches('modules/*/rules/**', 'modules/ledger/services/write.ts')).toBe(false);
  });

  test('a/** matches a itself — a layer declared as a folder owns the folder', () => {
    expect(matches('src/graph/**', 'src/graph')).toBe(true);
    expect(matches('src/graph/**', 'src/graph/edges.ts')).toBe(true);
  });

  test('? is exactly one non-slash character', () => {
    expect(matches('a?.ts', 'ab.ts')).toBe(true);
    expect(matches('a?.ts', 'abc.ts')).toBe(false);
  });

  test('braces alternate', () => {
    expect(matches('src/**/*.{ts,tsx}', 'src/a/b.tsx')).toBe(true);
    expect(matches('src/**/*.{ts,tsx}', 'src/a/b.js')).toBe(false);
  });

  test('dots are literal, not any-character', () => {
    expect(matches('a.ts', 'axts')).toBe(false);
  });

  test('a LEADING globstar matches at every depth — the bug the model probe found', () => {
    for (const path of ['a.ts', 'src/a.ts', 'src/routes/a.ts']) {
      expect(matches('**/*.ts', path)).toBe(true);
    }
    expect(matches('**/*.ts', 'src/a.js')).toBe(false);
  });

  test('a leading globstar with a brace group matches at every depth', () => {
    const pattern = '**/*.{ts,tsx,js,jsx}';
    expect(matches(pattern, 'src/routes/thick.ts')).toBe(true);
    expect(matches(pattern, 'top.jsx')).toBe(true);
    expect(matches(pattern, 'src/a.md')).toBe(false);
  });

  test('a globstar in the middle matches zero or more segments', () => {
    expect(matches('src/**/x.ts', 'src/x.ts')).toBe(true);
    expect(matches('src/**/x.ts', 'src/a/x.ts')).toBe(true);
    expect(matches('src/**/x.ts', 'src/a/b/x.ts')).toBe(true);
    expect(matches('src/**/x.ts', 'other/x.ts')).toBe(false);
  });

  test('a lone globstar matches everything', () => {
    expect(matches('**', 'a')).toBe(true);
    expect(matches('**', 'a/b/c.ts')).toBe(true);
  });

  test('consecutive globstars behave as one', () => {
    expect(matches('**/**', 'a')).toBe(true);
    expect(matches('**/**', 'a/b')).toBe(true);
    expect(matches('a/**/**/b', 'a/b')).toBe(true);
    expect(matches('a/**/**/b', 'a/x/b')).toBe(true);
    expect(matches('a/**/**/b', 'a/x/y/b')).toBe(true);
    expect(matches('a/**/**/b', 'a/x/c')).toBe(false);
  });

  test('a trailing slash means the directory and everything under it', () => {
    expect(matches('src/util/', 'src/util/glob.ts')).toBe(true);
    expect(matches('src/util/', 'src/util/nested/deep.ts')).toBe(true);
    expect(matches('src/util/', 'src/util')).toBe(true);
    expect(matches('src/util/', 'src/utility.ts')).toBe(false);
    expect(matches('src/**/', 'src/a/b.ts')).toBe(true);
  });

  test('negation wins in a list', () => {
    const patterns = ['src/**', '!src/**/*.test.ts'];
    expect(matchesAny(patterns, 'src/graph/edges.ts')).toBe(true);
    expect(matchesAny(patterns, 'src/graph/edges.test.ts')).toBe(false);
  });
});

describe('globProblems', () => {
  test('every shape the matcher supports is sound', () => {
    const sound = [
      'src/**',
      'src/util/**',
      'src/util/',
      'architecture.config.ts',
      'modules/*/rules/**',
      '**/*.{ts,tsx,js,jsx}',
      '**',
      'a/**/**/b',
      'a?.ts',
      '!src/**/*.test.ts',
      'fixtures/rules/{id}.violation.ts',
    ];
    for (const pattern of sound) {
      expect(globProblems(pattern)).toEqual([]);
    }
  });

  test('an empty pattern is a problem, because it matches nothing', () => {
    expect(globProblems('')).toHaveLength(1);
    expect(globProblems('')[0]).toContain('empty');
    // A bare negation is an empty pattern once the `!` is stripped.
    expect(globProblems('!')).toHaveLength(1);
  });

  test('a leading separator is a problem, because every path is repo-relative', () => {
    expect(globProblems('/src/**')).toHaveLength(1);
    expect(globProblems('/src/**')[0]).toContain('repo-relative');
    expect(globProblems('!/src/**')).toHaveLength(1);
  });

  test('a doubled separator is a problem — it asks for an empty path segment', () => {
    expect(globProblems('src//util/**')).toHaveLength(1);
    expect(globProblems('src//util/**')[0]).toContain('segment');
  });

  test('an unclosed brace is a problem', () => {
    expect(globProblems('src/*.{ts,tsx')).toHaveLength(1);
    expect(globProblems('src/*.{ts,tsx')[0]).toContain('{');
  });

  test('an empty brace alternative is a problem', () => {
    expect(globProblems('src/*.{ts,,tsx}')).toHaveLength(1);
    expect(globProblems('src/*.{}')).toHaveLength(1);
    expect(globProblems('src/*.{,ts}')).toHaveLength(1);
    expect(globProblems('src/*.{ts,}')).toHaveLength(1);
  });

  test('the negation prefix is stripped before checking, not reported', () => {
    expect(globProblems('!src/**')).toEqual([]);
    expect(globProblems('!src//x')).toEqual(globProblems('src//x'));
  });

  test('every problem is returned at once, not the first', () => {
    expect(globProblems('/src//*.{ts').length).toBeGreaterThanOrEqual(3);
  });
});

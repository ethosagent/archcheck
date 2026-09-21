import { describe, expect, test } from 'bun:test';
import { matches, matchesAny } from './glob.js';

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

  test('negation wins in a list', () => {
    const patterns = ['src/**', '!src/**/*.test.ts'];
    expect(matchesAny(patterns, 'src/graph/edges.ts')).toBe(true);
    expect(matchesAny(patterns, 'src/graph/edges.test.ts')).toBe(false);
  });
});

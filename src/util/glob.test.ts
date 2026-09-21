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

  test('negation wins in a list', () => {
    const patterns = ['src/**', '!src/**/*.test.ts'];
    expect(matchesAny(patterns, 'src/graph/edges.ts')).toBe(true);
    expect(matchesAny(patterns, 'src/graph/edges.test.ts')).toBe(false);
  });
});

import type { EdgeFilter } from '../types.js';
import { matchesAny } from './glob.js';

// Default glob patterns for identifying test files.
export const DEFAULT_TEST_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__mocks__/**',
];

// Check if a relative path matches any test glob.
export function isTestFile(tests: readonly string[], relativePath: string): boolean {
  return matchesAny(tests, relativePath);
}

// Determine if an edge is in scope based on filter and source test status.
export function edgeInScope(filter: EdgeFilter, fromIsTest: boolean): boolean {
  if (filter === 'production' && fromIsTest) {
    return false;
  }
  return true;
}

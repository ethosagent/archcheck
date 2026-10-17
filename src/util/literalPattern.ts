// Cache compiled patterns because they run against every string in scope.
const cache = new Map<string, RegExp | undefined>();

function compiled(pattern: string): RegExp | undefined {
  if (cache.has(pattern)) return cache.get(pattern);
  let expression: RegExp | undefined;
  try {
    expression = new RegExp(pattern);
  } catch {
    // An uncompilable pattern is a config error the caller reports, not a crash mid-run.
    expression = undefined;
  }
  cache.set(pattern, expression);
  return expression;
}

// Validate a pattern without throwing, returning problems for config errors.
export function patternProblems(pattern: unknown): string[] {
  if (typeof pattern !== 'string') return ['must be a string holding a regular expression'];
  if (pattern.length === 0) return ['must not be empty, or it matches every string'];
  if (compiled(pattern) === undefined) return [`is not a valid regular expression: ${pattern}`];
  return [];
}

// Test text against a pattern, returning false if the pattern is invalid.
export function matchesPattern(pattern: string, text: string): boolean {
  return compiled(pattern)?.test(text) === true;
}

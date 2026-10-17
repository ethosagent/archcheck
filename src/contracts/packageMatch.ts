// A slash in a scope is not a directory separator.
export function packageMatches(pattern: string, specifier: string): boolean {
  if (pattern === specifier) return true;
  if (!pattern.endsWith('/*')) return false;
  const prefix = pattern.slice(0, -2);
  return specifier === prefix || specifier.startsWith(`${prefix}/`);
}

// Returns true when any pattern matches the specifier.
export function packageMatchesAny(patterns: readonly string[], specifier: string): boolean {
  return patterns.some((p) => packageMatches(p, specifier));
}

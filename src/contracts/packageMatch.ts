// A slash in a scope is not a directory separator.
// A trailing star also reads a colon namespace.
export function packageMatches(pattern: string, specifier: string): boolean {
  if (pattern === specifier) return true;
  if (!pattern.endsWith('*')) return false;
  const prefix = pattern.slice(0, -1);
  if (specifier.startsWith(prefix)) return true;
  if (prefix.endsWith('/')) {
    return specifier === prefix.slice(0, -1);
  }
  return false;
}

// Returns true when any pattern matches the specifier.
export function packageMatchesAny(patterns: readonly string[], specifier: string): boolean {
  return patterns.some((p) => packageMatches(p, specifier));
}

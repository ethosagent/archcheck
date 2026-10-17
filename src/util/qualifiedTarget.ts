// Returns true when the target contains a hash separator.
export function isQualified(target: string): boolean {
  return target.includes('#');
}

// Checks if a pattern matches a value, supporting trailing star wildcards.
function partMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (!pattern.endsWith('*')) return false;
  return value.startsWith(pattern.slice(0, -1));
}

// A resolved symbol is written module then a hash then member.
export function qualifiedMatches(target: string, resolved: string): boolean {
  const hash = target.indexOf('#');
  if (hash === -1) return false;

  const resolvedHash = resolved.indexOf('#');
  if (resolvedHash === -1) return false;

  const targetModule = target.slice(0, hash);
  const targetMember = target.slice(hash + 1);
  const resolvedModule = resolved.slice(0, resolvedHash);
  const resolvedMember = resolved.slice(resolvedHash + 1);

  if (!partMatches(targetModule, resolvedModule)) return false;
  return partMatches(targetMember, resolvedMember);
}

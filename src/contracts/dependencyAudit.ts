// Pure helpers for auditing declared dependencies against an architecture policy.
// Callers supply the package object and policy; this module reads no files.

export type PackageLike = { dependencies?: unknown; devDependencies?: unknown };
export type AuditPolicy = { allowed: readonly string[]; unassigned: readonly string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dependencyNamesOf(pkg: PackageLike, includeDev: boolean): string[] {
  const names = new Set<string>();
  if (isPlainObject(pkg.dependencies)) {
    for (const key of Object.keys(pkg.dependencies)) names.add(key);
  }
  if (includeDev && isPlainObject(pkg.devDependencies)) {
    for (const key of Object.keys(pkg.devDependencies)) names.add(key);
  }
  return [...names].sort();
}

export function unapprovedDependencies(names: readonly string[], policy: AuditPolicy): string[] {
  return names.filter(
    (name) => !policy.allowed.includes(name) && !policy.unassigned.includes(name),
  );
}

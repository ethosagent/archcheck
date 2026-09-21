/**
 * Path normalisation, in one place.
 *
 * What rule this enforces: the identity hash must not contain an absolute path, or two developers
 * with different checkout directories produce different hashes for the same violation and the
 * baseline becomes per-machine noise (plan 07). Every path that reaches evidence, a diagnostic or
 * a generated file goes through here first.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** POSIX separators, always — a generated file must be byte-identical on Windows and macOS. */
export function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/** Repo-relative and POSIX. The canonical form for evidence, findings and generated output. */
export function repoRelative(root: string, path: string): string {
  const abs = isAbsolute(path) ? path : resolve(root, path);
  return toPosix(relative(resolve(root), abs));
}

export function absoluteFrom(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

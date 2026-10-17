/**
 * Layer matching: a path glob, or `implements: 'PortName'`.
 *
 * What rule this enforces: the second form is the other reason we own the graph (plan 04). A
 * layer defined as "everything implementing this port" cannot be expressed as a path, and it is
 * the right way to say it — an adapter is an adapter because of what it implements, not because of
 * where someone filed it.
 */

import { toGlob } from '../util/captures.js';
import { matchesAny } from '../util/glob.js';
import { repoRelative } from '../util/paths.js';
import type { FileFacts } from './types.js';

/** `'src/**'`, a list of those, or a structural match through the type checker. */
export type LayerMatch = string | string[] | { implements: string };

export function isImplementsMatch(match: unknown): match is { implements: string } {
  return (
    typeof match === 'object' &&
    match !== null &&
    typeof (match as { implements?: unknown }).implements === 'string'
  );
}

export function isValidMatch(match: unknown): match is LayerMatch {
  if (typeof match === 'string') return match.length > 0;
  if (Array.isArray(match)) return match.length > 0 && match.every((m) => typeof m === 'string');
  return isImplementsMatch(match);
}

export function fileMatches(
  match: LayerMatch,
  absoluteFile: string,
  root: string,
  facts: FileFacts | undefined,
): boolean {
  if (isImplementsMatch(match)) {
    return facts?.implementsPorts.includes(match.implements) === true;
  }
  // `{name}` is a capture, and for MEMBERSHIP it is just one segment. Reducing it to `*` keeps
  // the one glob compiler in charge: a second, capture-aware parser would drift from it, which is
  // the fault `globProblems` exists to prevent.
  const patterns = (typeof match === 'string' ? [match] : match).map(toGlob);
  return matchesAny(patterns, repoRelative(root, absoluteFile));
}

export function describeMatch(match: LayerMatch): string {
  if (isImplementsMatch(match)) return `implements ${match.implements}`;
  return (typeof match === 'string' ? [match] : match).join(', ');
}

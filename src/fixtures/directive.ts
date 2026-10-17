// Shared with the fixture suite so the two cannot drift.
const DIRECTIVE = /^\/\/ archcheck-fixture:\s*(place-at|append-to|verified-by)\s+(.+)$/m;

export type FixtureDirective =
  | { kind: 'place-at'; path: string }
  | { kind: 'append-to'; path: string }
  | { kind: 'verified-by'; test: string };

// An unknown kind is undefined rather than a guess.
export function readDirective(source: string): FixtureDirective | undefined {
  const match = DIRECTIVE.exec(source);
  if (match === null) return undefined;

  const kind = match[1];
  const value = match[2];
  if (kind === undefined || value === undefined) return undefined;

  if (kind === 'verified-by') {
    return { kind: 'verified-by', test: value.replace(/^"|"$/g, '') };
  }
  if (kind === 'place-at') return { kind: 'place-at', path: value };
  if (kind === 'append-to') return { kind: 'append-to', path: value };
  return undefined;
}

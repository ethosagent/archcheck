/**
 * The glob matcher used by every `match` and `appliesTo` in a manifest.
 *
 * Why ours rather than a dependency: archcheck ships with zero runtime dependencies so that
 * adopting it cannot drag a transitive tree into a consumer's build. The supported surface is
 * deliberately small — it is a path matcher, not a shell.
 *
 * What a caller must know: patterns are POSIX and repo-relative, matched against paths already
 * put through `repoRelative()`. Supported:
 *   *        any run of characters except `/`
 *   **       any run of characters including `/` (and `a/**` also matches `a` itself)
 *   ?        exactly one character except `/`
 *   {a,b}    alternation
 *   !pat     negation, when a pattern list is matched with `matchesAny`
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;

function segmentToRegex(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*') {
      const isDouble = pattern[i + 1] === '*';
      if (isDouble) {
        // `a/**/b` and `a/**` must both match `a/b` and `a` respectively, so the slash is
        // swallowed by the wildcard rather than required around it.
        const before = out.endsWith('/') ? 1 : 0;
        if (before) out = out.slice(0, -1);
        out += '(?:/.*)?';
        i += 2;
        if (pattern[i] === '/') i += 1;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const close = pattern.indexOf('}', i);
      if (close !== -1) {
        const alts = pattern.slice(i + 1, close).split(',');
        out += `(?:${alts.map((a) => segmentToRegex(a)).join('|')})`;
        i = close + 1;
        continue;
      }
    }
    out += ch.replace(SPECIAL, '\\$&');
    i += 1;
  }
  return out;
}

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(`^${segmentToRegex(pattern)}$`);
  cache.set(pattern, compiled);
  return compiled;
}

export function matches(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

/**
 * Match against a list. A leading `!` negates, and negations win, so a list like
 * `['src/**', '!src/test-only']` reads the way a reader expects it to.
 */
export function matchesAny(patterns: readonly string[], path: string): boolean {
  let hit = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (matches(pattern.slice(1), path)) return false;
    } else if (matches(pattern, path)) {
      hit = true;
    }
  }
  return hit;
}

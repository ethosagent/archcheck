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
 *   **       zero or more whole path segments (and `a/**` also matches `a` itself)
 *   ?        exactly one character except `/`
 *   {a,b}    alternation
 *   dir/     a trailing slash is that directory and everything under it
 *   !pat     negation, when a pattern list is matched with `matchesAny`
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;

/**
 * One path segment — no slashes. `*`, `?` and `{a,b}` only; `**` is handled a level up, where the
 * pattern has already been split on `/`.
 *
 * ponytail: a brace group containing a slash (`{a/b,c}`) is not supported, because the split
 * happens first. Nothing in this repo or its fixtures writes one. Upgrade path if that changes:
 * tokenise before splitting instead of after.
 */
function segmentToRegex(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*') {
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

/**
 * Split a pattern into the segments `patternToRegexSource` walks, with the two shapes that would
 * otherwise compile to an unmatchable regex folded away first. Both folds exist because a pattern
 * that matches nothing looks exactly like a rule that is satisfied (AGENTS.md rule 14).
 *
 * - A trailing slash is TOLERATED rather than rejected, and reads gitignore-style: the directory
 *   and everything under it. Tolerating it costs one line, matches what every reader of a
 *   manifest already expects a directory to mean, and a manifest is written by hand — rejecting
 *   it would need a validation seam that does not exist here yet. So the empty final segment a
 *   trailing slash produces becomes a globstar, which is already the spelling for "this directory
 *   and everything beneath it". Without this the regex required a trailing slash, and no
 *   `repoRelative()` path has one.
 * - Consecutive globstars collapse to one. Each non-final globstar emits its own mandatory
 *   separator, so two in a row required a double slash, which no path has either.
 *
 * `src/util/glob.test.ts` pins both.
 */
function toSegments(pattern: string): string[] {
  const raw = pattern.split('/');
  if (raw.length > 1 && raw[raw.length - 1] === '') raw[raw.length - 1] = '**';
  return raw.filter((segment, index) => !(segment === '**' && raw[index - 1] === '**'));
}

/**
 * The whole pattern, segment by segment. `**` is the only token that spans segments, and it has
 * three distinct shapes — getting any of them wrong is silent, because a pattern that matches
 * nothing looks exactly like a rule that is satisfied:
 *
 * - a lone globstar matches everything.
 * - a globstar as the LAST segment matches its parent directory and anything beneath it.
 * - a globstar in any other position matches zero or more intervening segments.
 *
 * The third shape at the START of a pattern was the one that was broken: it produced a regex
 * requiring a leading slash, so a leading globstar followed by a filename pattern matched only
 * top-level files. The model probe's file scan was the caller that found it.
 *
 * Repeated globstars and a trailing slash are folded away by `toSegments` before this walk, so
 * every shape below sees at most one globstar in a row and no empty final segment.
 */
function patternToRegexSource(pattern: string): string {
  const segments = toSegments(pattern);
  let out = '';
  let needsSeparator = false;

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (segment === '**') {
      if (isLast) {
        out += out === '' ? '.*' : '(?:/.*)?';
      } else {
        out += out === '' ? '(?:[^/]+/)*' : '(?:/[^/]+)*/';
        needsSeparator = false;
      }
      continue;
    }
    if (needsSeparator) out += '/';
    out += segmentToRegex(segment);
    needsSeparator = true;
  }

  return out;
}

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(`^${patternToRegexSource(pattern)}$`);
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

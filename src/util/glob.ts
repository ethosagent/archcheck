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
 *
 * `problems`, when supplied, collects the structural defects this walk sees — the sink
 * `globProblems` passes in so that the validator and the compiler are one walk and cannot
 * disagree. Compilation is unchanged either way: nothing here reads the sink back.
 */
function segmentToRegex(pattern: string, problems?: string[]): string {
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
        if (alts.some((a) => a.length === 0)) {
          problems?.push(`has an empty alternative in the group '${pattern.slice(i, close + 1)}'`);
        }
        out += `(?:${alts.map((a) => segmentToRegex(a, problems)).join('|')})`;
        i = close + 1;
        continue;
      }
      problems?.push("has an unclosed '{'");
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

/**
 * The structural defects in a pattern — empty when it is sound. One sentence per defect, every one
 * at once, each phrased to follow a field name so a caller can compose "params.appliesTo pattern
 * 'x' has an empty path segment ...".
 *
 * Why it exists: a pattern that matches nothing is indistinguishable from a rule that is satisfied
 * (AGENTS.md rule 14). `layers.match` fails loudly when it matches nothing — the files become
 * unlayered — but every other glob in a manifest just stops checking, silently and forever.
 *
 * Why it walks the SAME segments as the compiler, through `toSegments` and `segmentToRegex`: a
 * second, independent parser would drift from `patternToRegexSource` and start approving patterns
 * the matcher quietly drops. So this reports only what that walk decides structurally, and it is
 * deliberately silent about whether any file exists — "this matches nothing in THIS repo" needs the
 * file list and is a warning, not an error.
 *
 * Called from the shared pass in `src/registry/validate.ts`, so every rule kind is covered without
 * opting in. Pinned by the `globProblems` suite in `src/util/glob.test.ts`.
 */
export function globProblems(pattern: string): string[] {
  // A negation is legal in every list form (`matchesAny`), and it is not part of the path.
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;
  if (body.length === 0) return ['is empty, so it matches nothing'];

  const problems: string[] = [];
  if (body.startsWith('/')) {
    problems.push('starts with a separator, but every path it is matched against is repo-relative');
  }

  for (const [index, segment] of toSegments(body).entries()) {
    if (segment === '') {
      // Index 0 is the leading separator, already named. A trailing separator is folded to a
      // globstar by `toSegments` and is legal, so any empty segment left here is a doubled one.
      if (index > 0) problems.push('has an empty path segment, from a doubled separator');
      continue;
    }
    if (segment === '**') continue;
    segmentToRegex(segment, problems);
  }

  return problems;
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

/**
 * `archcheck/biome` — the generated lint sink, as a Biome config fragment.
 *
 * Why this exists: the same reason as `archcheck/eslint`. The README promises that your editor
 * shows each rule as you type, and a Biome user got nothing — `emit` wrote `lint.overrides.json`
 * in archcheck's own shape and only ESLint could read it back.
 *
 * What a caller must know: this says LESS than the ESLint half, and the gap is deliberate twice
 * over.
 *
 * Biome has no rule that reads comment text, no filename rule, and nothing like
 * `no-restricted-syntax`, so most kinds cannot be expressed at all. Two refusals are judgement
 * calls rather than absences. A DOTTED `member-access` target (`console.log`) could be expressed
 * by `nursery.noJsRestrictedProperties`, and is not: nursery is documented as unstable, and this
 * fragment ends up in a committed file, so a Biome upgrade could break a consumer's whole lint
 * config or silently stop checking while still looking declared. A bare target (`console`) is
 * stable, and is expressed. And `empty-catch` could be expressed by
 * `suspicious.noEmptyBlockStatements`, which has no catch scope — it flags EVERY empty block, so
 * the editor would be louder than the gate, and the two would disagree about what is allowed.
 *
 * `no-restricted-imports` also matches the specifier as written, while archcheck's patterns are
 * repo-relative paths, so a relative import is not flagged. That is the same under-approximation
 * the ESLint adapter carries, for the same reason: the editor may be quieter than the gate, and
 * must never be louder.
 *
 * Everything it cannot say comes back in `unexpressed`, and the generated file's header lists the
 * same ids under `notExpressedByBiome`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BiomeAdapted, type SinkEntry, toBiomeConfig } from './biomeConfig.js';

/** The generated file this reads. Relative to the generated directory. */
export const LINT_SINK = 'lint.overrides.json';

/**
 * Read the generated sink and return the overrides and what could not be expressed.
 *
 * A missing file is an empty fragment rather than a throw: a project that has not run `emit` yet
 * should get a linter that says nothing, not a linter that will not start.
 */
export function archcheckBiomeConfig(generatedDir = 'generated'): BiomeAdapted {
  let source: string;
  try {
    source = readFileSync(join(generatedDir, LINT_SINK), 'utf8');
  } catch {
    // Not emitted yet. An editor opening a fresh clone is the common case here.
    return { overrides: [], unexpressed: [] };
  }

  const parsed = JSON.parse(source) as { rules?: unknown };
  const entries = Array.isArray(parsed.rules) ? (parsed.rules as SinkEntry[]) : [];
  return toBiomeConfig(entries);
}

/**
 * The fragment to merge into a `biome.json`, as `{ overrides: [...] }`.
 *
 * Biome has no `extends` for a computed value, so a consumer either copies this into their
 * `biome.json` from a small script, or keeps a `biome.generated.json` written from it and lists
 * that in `extends`. Both are in the README.
 */
export function archcheckBiomeOverrides(generatedDir = 'generated'): {
  overrides: BiomeAdapted['overrides'];
} {
  return { overrides: archcheckBiomeConfig(generatedDir).overrides };
}

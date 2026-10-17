/**
 * `archcheck/eslint` — the generated lint sink, as ESLint flat config.
 *
 * Why this exists: the README promised that your editor shows each rule as you type, and nothing
 * shipped that made it true. `emit` wrote `lint.overrides.json` in archcheck's own shape and no
 * adapter read it back, so the rules appeared only when `archcheck` ran.
 *
 * What a caller must know: this is a SUBSET, and it under-approximates in two ways on purpose.
 *
 * `no-restricted-imports` matches the import SPECIFIER as written, while archcheck's patterns are
 * repo-relative paths. So `import '../service/x.js'` is not flagged by a pattern of
 * `src/service/**`, while `import 'src/service/x.js'` is. ESLint therefore flags a subset of what
 * archcheck flags, never a superset — the editor can be quieter than the gate, and must never be
 * louder, or the two disagree about what is allowed.
 *
 * And this is a SUBSET of kinds, deliberately. Core ESLint has no filename rule and
 * no rule that reads comment text, so two kinds cannot be expressed at all — their rule ids come
 * back in `unexpressed`, and the generated file's header lists them. archcheck stays the gate, so
 * the editor and CI never disagree silently about a rule the editor cannot see.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AdaptedConfig, type SinkEntry, toEslintConfig } from './eslintConfig.js';

/** The generated file this reads. Relative to the generated directory. */
export const LINT_SINK = 'lint.overrides.json';

/**
 * Read the generated sink and return flat-config blocks.
 *
 * A missing file is an empty config rather than a throw: a project that has not run `emit` yet
 * should get a linter that says nothing, not a linter that will not start.
 */
export function archcheckEslintConfig(generatedDir = 'generated'): AdaptedConfig {
  let source: string;
  try {
    source = readFileSync(join(generatedDir, LINT_SINK), 'utf8');
  } catch {
    // Not emitted yet. An editor opening a fresh clone is the common case here.
    return { blocks: [], unexpressed: [] };
  }

  const parsed = JSON.parse(source) as { rules?: unknown };
  const entries = Array.isArray(parsed.rules) ? (parsed.rules as SinkEntry[]) : [];
  return toEslintConfig(entries);
}

/** The blocks alone, for spreading straight into a flat config array. */
export function archcheckEslintBlocks(generatedDir = 'generated'): AdaptedConfig['blocks'] {
  return archcheckEslintConfig(generatedDir).blocks;
}

/**
 * `defineArchitecture` — the one function a manifest calls.
 *
 * What this is for: giving `architecture.config.ts` a type without giving it any runtime
 * behaviour. It is an identity function on purpose. A manifest that ran logic at load time would
 * be a program pretending to be a declaration, and the whole value of the manifest is that it can
 * be read by a person, a generator and a diff.
 *
 * What a caller must know: nothing here validates. Validation is total and lives in
 * `validate.ts`, because it must be able to return every problem at once rather than throwing on
 * the first (a malformed manifest exits 2, not 1).
 */
import type { ArchitectureException } from '../exceptions/index.js';
import type { Rule } from '../types.js';

export type ArchitectureManifest = {
  /**
   * The repository root every path in the manifest is relative to. Defaults to the directory
   * holding the config, which is what almost everyone wants.
   */
  root?: string;
  /** The tsconfig the module graph is built from. Defaults to `<root>/tsconfig.json`. */
  tsconfig?: string;
  /** Where generated output is written. Defaults to `generated`. */
  generatedDir?: string;
  /**
   * Documents with an `archcheck:begin rules-table` fence. Only the fenced region is generated —
   * long-form prose stays hand-written, because a manifest holding paragraphs is a config file
   * pretending to be a document (LLD §1.9).
   */
  docs?: string[];
  /**
   * Which files are tests, as globs. Defaults to `DEFAULT_TEST_GLOBS` in `src/util/testEdges.ts`,
   * which follows the conventions almost every repository already has. Listed there and not here,
   * so there is one copy of them.
   *
   * A rule reads this through `edges: 'production'`, which skips edges starting in a test file.
   */
  tests?: string[];
  /** The only place a rule is defined. */
  rules: Rule[];
  /**
   * The only legitimate way past a rule: owned, reasoned and expiring. Never inline — an inline
   * suppression comment is itself a violation (plan 12, plan 15).
   */
  exceptions?: ArchitectureException[];
};

export function defineArchitecture(config: ArchitectureManifest): ArchitectureManifest {
  return config;
}

/**
 * The graph vocabulary. The edge is the unit (LLD §4, plan 04).
 *
 * What a caller must know: `from` and `to` are absolute. Everything that reaches a finding, a
 * generated file or an identity hash goes through `repoRelative()` first — an absolute path in
 * evidence makes the hash differ per checkout, which would make the baseline per-machine noise.
 */
import type ts from 'typescript';
import type { Result } from '../result.js';
import type { SyntaxFacts } from './syntax.js';

/**
 * `computed` is the reason we own the graph. A dynamic import with a non-literal specifier
 * resolves to nothing, so it is invisible to a module-graph tool — and it is exactly how a layer
 * violation hides. We report it so `banned-syntax` can forbid it and the graph stays complete.
 */
export type DynamicKind = 'none' | 'literal' | 'computed';

export type Edge = {
  /** Absolute path of the importing file. */
  from: string;
  /** Absolute path of the imported file, or the bare specifier when `external`. */
  to: string;
  /** The specifier exactly as written, which is what a remedy has to quote back. */
  specifier: string;
  external: boolean;
  /** `import type` — some rules care, most do not. */
  typeOnly: boolean;
  dynamic: DynamicKind;
  /** 1-based, precomputed so an edge restored from cache keeps its position. */
  line: number;
  col: number;
  /** Absent when this edge came from the cache rather than from a walk. */
  node?: ts.Node;
};

export type FileFacts = {
  /** Absolute path. */
  file: string;
  edges: Edge[];
  /** Interface names this file declares an implementation of — for `match: { implements }`. */
  implementsPorts: string[];
  /** Exported symbol names, for the `naming` kind. */
  exports: string[];
  /**
   * What the syntax requests derived from the manifest found in this file. Absent when the run
   * asked nothing — which is not the same as "asked and found nothing", so a reader that needs
   * the difference checks for the KEY, not for the field.
   */
  syntax?: SyntaxFacts;
};

export type ModuleGraph = {
  /** Absolute paths of every file in the program that is not a declaration file. */
  files: readonly string[];
  edges: readonly Edge[];
  factsFor(file: string): FileFacts | undefined;
  /** How many files were walked rather than restored from cache — the cache-hit assertion. */
  readonly walkedCount: number;
};

/**
 * Where a graph comes from.
 *
 * There is one implementation today, the TypeScript reader, and the seam exists anyway: it is what
 * keeps every `typescript` import on one side of the line, so the rule that forbids the compiler
 * API in `src/contracts/**` has somewhere to send the work instead. A second frontend — another
 * language, or a graph handed over by a build tool — implements this and nothing else changes.
 */
export type Frontend = {
  read(): Result<ModuleGraph>;
};

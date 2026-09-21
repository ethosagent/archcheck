/**
 * The graph vocabulary. The edge is the unit (LLD §4, plan 04).
 *
 * What a caller must know: `from` and `to` are absolute. Everything that reaches a finding, a
 * generated file or an identity hash goes through `repoRelative()` first — an absolute path in
 * evidence makes the hash differ per checkout, which would make the baseline per-machine noise.
 */
import type ts from 'typescript';

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
};

export type ModuleGraph = {
  /** Absolute paths of every file in the program that is not a declaration file. */
  files: readonly string[];
  edges: readonly Edge[];
  factsFor(file: string): FileFacts | undefined;
  /**
   * The SourceFile the reader already parsed. Present when the graph came from a real Program,
   * absent when it was restored from a written report — which is why the lint probe's `run()`
   * needs a program and its `ingest()` does not.
   */
  sourceFileFor(file: string): ts.SourceFile | undefined;
  /** How many files were walked rather than restored from cache — the cache-hit assertion. */
  readonly walkedCount: number;
};

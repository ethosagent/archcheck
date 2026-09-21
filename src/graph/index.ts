/**
 * The module graph. One parse, shared by every probe.
 *
 * What a caller must know: `read()` builds the whole graph every time — that is honest, and it is
 * unavoidable, because computing "which files depend on the changed ones" needs the whole graph
 * anyway (LLD §1.8). What the cache saves is the per-file walk; what diff scoping saves is rule
 * evaluation and every model call. Those are where the cost actually is.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { err, ok, type Result } from '../result.js';
import { createFactsCache, createNullCache, type FactsCache, hashContent } from './cache.js';
import { extractFacts, type ResolveSpecifier } from './edges.js';
import { buildProgram } from './program.js';
import type { Edge, FileFacts, ModuleGraph } from './types.js';

export type ReadOptions = {
  root: string;
  tsconfigPath: string;
  /** Off for tests that must observe every walk. */
  cache?: boolean;
};

function makeResolver(options: ts.CompilerOptions): ResolveSpecifier {
  const host = ts.createCompilerHost(options, false);
  const moduleCache = ts.createModuleResolutionCache(process.cwd(), (s) => s, options);
  return (specifier, containingFile) => {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, host, moduleCache);
    const module = resolved.resolvedModule;
    if (!module) {
      // Unresolvable. A relative specifier that resolves to nothing is a broken import, which
      // the type checker already reports; a bare one is a package we do not have. Either way it
      // is external as far as the dependency law is concerned.
      return { resolved: undefined, external: !specifier.startsWith('.') };
    }
    return {
      resolved: module.resolvedFileName,
      external:
        module.isExternalLibraryImport === true ||
        module.resolvedFileName.includes('/node_modules/'),
    };
  };
}

export function readGraph(options: ReadOptions): Result<ModuleGraph> {
  const built = buildProgram(options.tsconfigPath);
  if (!built.ok) return built;
  const { program, checker, optionsFingerprint } = built.value;

  const cache: FactsCache =
    options.cache === false
      ? createNullCache()
      : createFactsCache(options.root, optionsFingerprint);

  const resolve = makeResolver(built.value.options);
  const facts = new Map<string, FileFacts>();
  const edges: Edge[] = [];
  const files: string[] = [];
  let walked = 0;

  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    if (source.fileName.includes('/node_modules/')) continue;
    files.push(source.fileName);

    let contentHash: string;
    try {
      contentHash = hashContent(readFileSync(source.fileName, 'utf8'));
    } catch {
      contentHash = hashContent(source.text);
    }

    const cached = cache.get(source.fileName, contentHash);
    if (cached) {
      facts.set(source.fileName, cached);
      edges.push(...cached.edges);
      continue;
    }

    const fresh = extractFacts(source, checker, resolve);
    walked += 1;
    cache.set(source.fileName, contentHash, fresh);
    facts.set(source.fileName, fresh);
    edges.push(...fresh.edges);
  }

  cache.flush();

  if (files.length === 0) {
    return err([`${options.tsconfigPath} yielded no source files to check`]);
  }

  return ok({
    files,
    edges,
    factsFor: (file) => facts.get(file),
    walkedCount: walked,
  });
}

export {
  CACHE_DIR,
  createFactsCache,
  createNullCache,
  type FactsCache,
  hashContent,
} from './cache.js';
export { extractFacts, type ResolveSpecifier } from './edges.js';
export {
  describeMatch,
  fileMatches,
  isImplementsMatch,
  isValidMatch,
  type LayerMatch,
} from './match.js';
export { type BuiltProgram, buildProgram } from './program.js';
export type { DynamicKind, Edge, FileFacts, ModuleGraph } from './types.js';

/**
 * The content-hash cache for extracted file facts.
 *
 * What this honestly buys, stated precisely because the design review caught the overstatement
 * (LLD §1.8): it skips OUR AST walk for a file whose content has not changed. It does not skip
 * TypeScript's own parse — building the Program needs every file — and it does not skip the
 * graph. The walk is the part that scales with rule count, so the saving is real; the claim that
 * a whole file is skipped was not.
 *
 * What a caller must know: a cached edge has no `node`. Its `line`/`col` were precomputed at walk
 * time, so position survives, but anything that needs the AST must check for `node` first.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Edge, FileFacts } from './types.js';

export const CACHE_DIR = '.archcheck/cache';

/**
 * Create the cache directory with a `.gitignore` holding `*` inside it — the pytest and ruff
 * convention — so a consumer's repo never shows the cache as untracked. 0.2.0 did not, and a
 * 4.9 MiB facts.json tripped a monorepo's file-size lint. An existing `.gitignore` is never
 * overwritten (the `wx` flag). Only the cache is ignored: `.archcheck/baseline.json` and
 * `.archcheck/ids.json` sit outside it and are meant to be committed. Pinned by
 * src/graph/cache.test.ts. Every writer of the cache directory goes through here.
 */
export function ensureCacheDir(root: string): string {
  const dir = join(root, CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return dir;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

type SerialisableEdge = Omit<Edge, 'node'>;
type CachedFacts = { edges: SerialisableEdge[]; implementsPorts: string[]; exports: string[] };
type CacheFile = { schemaVersion: 1; fingerprint: string; files: Record<string, CachedFacts> };

export type FactsCache = {
  get(file: string, contentHash: string): FileFacts | undefined;
  set(file: string, contentHash: string, facts: FileFacts): void;
  flush(): void;
};

function stripNodes(facts: FileFacts): CachedFacts {
  return {
    edges: facts.edges.map(({ node: _node, ...rest }) => rest),
    implementsPorts: facts.implementsPorts,
    exports: facts.exports,
  };
}

/** A cache that remembers nothing — the default when a run has nowhere to write. */
export function createNullCache(): FactsCache {
  return { get: () => undefined, set: () => undefined, flush: () => undefined };
}

export function createFactsCache(root: string, fingerprint: string): FactsCache {
  const path = join(root, CACHE_DIR, 'facts.json');
  let loaded: CacheFile = { schemaVersion: 1, fingerprint, files: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CacheFile;
    // A compiler-options change invalidates everything: resolution may differ, so every
    // recorded `to` is suspect.
    if (parsed?.schemaVersion === 1 && parsed.fingerprint === fingerprint) loaded = parsed;
  } catch {
    // No cache yet, or an unreadable one. Either way, start empty rather than fail a run.
  }

  const next: CacheFile = { schemaVersion: 1, fingerprint, files: {} };
  let dirty = false;

  return {
    get(file, contentHash) {
      const entry = loaded.files[`${file}\u0000${contentHash}`];
      if (!entry) return undefined;
      next.files[`${file}\u0000${contentHash}`] = entry;
      return {
        file,
        edges: entry.edges.map((edge) => ({ ...edge })),
        implementsPorts: entry.implementsPorts,
        exports: entry.exports,
      };
    },
    set(file, contentHash, facts) {
      next.files[`${file}\u0000${contentHash}`] = stripNodes(facts);
      dirty = true;
    },
    flush() {
      try {
        // Before the dirty check, not after it: a warm cache an older version wrote is never
        // rewritten, so behind the check it would never gain its .gitignore.
        ensureCacheDir(root);
        if (dirty) writeFileSync(path, `${JSON.stringify(next)}\n`);
      } catch {
        // A cache we cannot write is a slow run, not a failed one.
      }
    },
  };
}

import { beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { repoRelative } from '../util/paths.js';
import { readGraph } from './index.js';
import { fileMatches } from './match.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'imports');
const TSCONFIG = join(ROOT, 'tsconfig.json');

function graph(cache: boolean) {
  const result = readGraph({ root: ROOT, tsconfigPath: TSCONFIG, cache });
  if (!result.ok) throw new Error(result.error.join('\n'));
  return result.value;
}

const rel = (path: string) => repoRelative(ROOT, path);

describe('edge extraction', () => {
  const g = graph(false);
  const consumer = g.edges.filter((e) => rel(e.from) === 'src/consumer/everyImportForm.ts');
  const find = (specifier: string) => consumer.find((e) => e.specifier === specifier);

  test('a static value import is an internal, non-type-only edge', () => {
    const edge = find('../adapters/remoteBlobStore.js');
    expect(edge).toBeDefined();
    expect(edge?.external).toBe(false);
    expect(edge?.typeOnly).toBe(false);
    expect(edge?.dynamic).toBe('none');
    expect(rel(edge?.to ?? '')).toBe('src/adapters/remoteBlobStore.ts');
  });

  test('an `import type` edge is marked type-only', () => {
    expect(find('../ports/blobStore.js')?.typeOnly).toBe(true);
  });

  test('a re-export is an edge too — it is how a barrel leaks', () => {
    const edge = find('../adapters/memoryBlobStore.js');
    expect(edge).toBeDefined();
    expect(rel(edge?.to ?? '')).toBe('src/adapters/memoryBlobStore.ts');
  });

  test('a node: builtin is external', () => {
    const edge = find('node:crypto');
    expect(edge?.external).toBe(true);
  });

  test('a literal dynamic import resolves and is marked literal', () => {
    const literal = consumer.filter((e) => e.dynamic === 'literal');
    expect(literal).toHaveLength(1);
    expect(rel(literal[0]?.to ?? '')).toBe('src/adapters/remoteBlobStore.ts');
  });

  test('a COMPUTED dynamic import is reported, which is why we own the graph', () => {
    const computed = consumer.filter((e) => e.dynamic === 'computed');
    expect(computed).toHaveLength(1);
    expect(computed[0]?.specifier).toContain('which');
    expect(computed[0]?.specifier).toContain('adapters/');
    expect(computed[0]?.line).toBeGreaterThan(0);
  });

  test('every edge carries a 1-based position and its AST node', () => {
    for (const edge of consumer) {
      expect(edge.line).toBeGreaterThan(0);
      expect(edge.col).toBeGreaterThan(0);
      expect(edge.node).toBeDefined();
    }
  });
});

describe('implements: matching through the checker', () => {
  const g = graph(false);

  test('a class implements clause matches the port', () => {
    const file = g.files.find((f) => rel(f) === 'src/adapters/remoteBlobStore.ts') ?? '';
    expect(g.factsFor(file)?.implementsPorts).toContain('BlobStore');
    expect(fileMatches({ implements: 'BlobStore' }, file, ROOT, g.factsFor(file))).toBe(true);
  });

  test('a factory returning the port matches too, through an import alias', () => {
    const file = g.files.find((f) => rel(f) === 'src/adapters/memoryBlobStore.ts') ?? '';
    // The file writes `Store`; the checker resolves the alias back to `BlobStore`.
    expect(g.factsFor(file)?.implementsPorts).toContain('BlobStore');
  });

  test('a file that implements nothing does not match', () => {
    const file = g.files.find((f) => rel(f) === 'src/ports/blobStore.ts') ?? '';
    expect(fileMatches({ implements: 'BlobStore' }, file, ROOT, g.factsFor(file))).toBe(false);
  });

  test('a glob match is repo-relative', () => {
    const file = g.files.find((f) => rel(f) === 'src/adapters/remoteBlobStore.ts') ?? '';
    expect(fileMatches('src/adapters/**', file, ROOT, undefined)).toBe(true);
    expect(fileMatches('src/ports/**', file, ROOT, undefined)).toBe(false);
  });
});

describe('the cache', () => {
  beforeEach(() => {
    rmSync(join(ROOT, '.archcheck'), { recursive: true, force: true });
  });

  test('a second run on unchanged files walks nothing', () => {
    const first = graph(true);
    expect(first.walkedCount).toBe(first.files.length);
    expect(first.walkedCount).toBeGreaterThan(0);

    const second = graph(true);
    expect(second.walkedCount).toBe(0);
    // And the restored edges are the same edges.
    expect(second.edges.length).toBe(first.edges.length);
  });

  test('a cached edge keeps its position but has no AST node', () => {
    graph(true);
    const second = graph(true);
    const computed = second.edges.find((e) => e.dynamic === 'computed');
    expect(computed?.line).toBeGreaterThan(0);
    expect(computed?.node).toBeUndefined();
  });

  test('cache off means every file is walked, every time', () => {
    expect(graph(false).walkedCount).toBeGreaterThan(0);
    expect(graph(false).walkedCount).toBe(graph(false).files.length);
  });
});

describe('a broken tsconfig is a CONFIG failure, not a code failure', () => {
  test('a missing tsconfig comes back as a Result, never a throw', () => {
    const result = readGraph({ root: ROOT, tsconfigPath: join(ROOT, 'nope.json'), cache: false });
    expect(result.ok).toBe(false);
  });
});

import { beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { repoRelative } from '../util/paths.js';
import { readGraph } from './index.js';
import { fileMatches } from './match.js';
import { requestKey, type SyntaxRequest } from './syntaxRequest.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'imports');
const TSCONFIG = join(ROOT, 'tsconfig.json');

function graph(cache: boolean, syntax: readonly SyntaxRequest[] = []) {
  const result = readGraph({ root: ROOT, tsconfigPath: TSCONFIG, cache, syntax });
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

describe('the cache covers the AST rules too', () => {
  const LITERALS: SyntaxRequest = { construct: 'string-literal' };
  const key = requestKey(LITERALS);
  const literalsIn = (g: ReturnType<typeof graph>) =>
    g.files.flatMap((file) => (g.factsFor(file)?.syntax?.[key] ?? []).map((one) => one.snippet));

  beforeEach(() => {
    rmSync(join(ROOT, '.archcheck'), { recursive: true, force: true });
  });

  test('a warm run serves the syntax facts without walking a file', () => {
    // The claim the ticket makes measurable: before 0.3.2 every AST rule re-walked every file on
    // every run, because the facts cache held edges and exports only.
    const first = graph(true, [LITERALS]);
    expect(first.walkedCount).toBe(first.files.length);
    const found = literalsIn(first);
    expect(found.length).toBeGreaterThan(0);

    const second = graph(true, [LITERALS]);
    expect(second.walkedCount).toBe(0);
    expect(literalsIn(second)).toEqual(found);
  });

  test('a different question throws the cache away rather than answering the old one', () => {
    // A stale answer here reads as a clean file, which is the worst way for this to fail.
    const first = graph(true, [LITERALS]);
    expect(first.walkedCount).toBeGreaterThan(0);

    const other = graph(true, [{ construct: 'empty-catch' }]);
    expect(other.walkedCount).toBe(other.files.length);
    expect(other.files.every((file) => other.factsFor(file)?.syntax?.[key] === undefined)).toBe(
      true,
    );
  });

  test('asking nothing stores nothing, so an edges-only run keeps its cache small', () => {
    const only = graph(true, []);
    expect(only.files.every((file) => only.factsFor(file)?.syntax === undefined)).toBe(true);
  });
});

describe('a broken tsconfig is a CONFIG failure, not a code failure', () => {
  test('a missing tsconfig comes back as a Result, never a throw', () => {
    const result = readGraph({ root: ROOT, tsconfigPath: join(ROOT, 'nope.json'), cache: false });
    expect(result.ok).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryFileSystem, createNodeFileSystem, type FileSystem } from './index.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'structure');

/**
 * Conformance: ONE suite, run against both implementations. This is the proof the memory twin is
 * a twin rather than a second, subtly different tool — and it is the same discipline archcheck
 * asks of the codebases it checks.
 */
function conformance(name: string, make: () => FileSystem) {
  describe(`${name} filesystem`, () => {
    test('exists answers for a present and an absent path', () => {
      const fs = make();
      expect(fs.exists('src/ports/blobStore.ts')).toBe(true);
      expect(fs.exists('src/adapters/memoryClock.ts')).toBe(false);
    });

    test('read returns content, and undefined rather than throwing', () => {
      const fs = make();
      expect(fs.read('src/ports/blobStore.ts')).toContain('BlobStore');
      expect(fs.read('nope.ts')).toBeUndefined();
    });

    test('glob returns repo-relative POSIX paths, sorted', () => {
      const fs = make();
      expect(fs.glob('src/ports/*.ts')).toEqual(['src/ports/blobStore.ts', 'src/ports/clock.ts']);
    });

    test('glob takes a list, and honours negation', () => {
      const fs = make();
      expect(fs.glob(['src/**/*.ts', '!src/routes/**'])).not.toContain('src/routes/eventRoutes.ts');
    });

    test('a glob matching nothing is an empty list, not an error', () => {
      expect(make().glob('src/nowhere/*.ts')).toEqual([]);
    });
  });
}

conformance('node', () => createNodeFileSystem(ROOT));
conformance('memory', () =>
  createMemoryFileSystem({
    'src/ports/blobStore.ts': 'export type BlobStore = { put(): Promise<void> };\n',
    'src/ports/clock.ts': 'export type Clock = { now(): number };\n',
    'src/adapters/memoryBlobStore.ts': 'export function createMemoryBlobStore() {}\n',
    'src/routes/eventRoutes.ts': 'registerRoute({});\n',
    'architecture.config.ts': 'export default {};\n',
  }),
);

describe('the node filesystem', () => {
  test('never walks into node_modules or .git', () => {
    const all = createNodeFileSystem(ROOT).glob('**');
    expect(all.some((path) => path.includes('node_modules'))).toBe(false);
    expect(all.some((path) => path.includes('.git/'))).toBe(false);
  });
});

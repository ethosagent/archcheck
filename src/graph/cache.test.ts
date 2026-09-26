import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CACHE_DIR, createFactsCache } from './cache.js';

function inTempRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'archcheck-cache-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const facts = { file: '/r/a.ts', edges: [], implementsPorts: [], exports: ['a'] };

describe('the cache directory ignores itself', () => {
  test('flushing the facts cache writes a .gitignore that ignores everything beside it', () => {
    inTempRoot((root) => {
      // 0.2.0 wrote a multi-megabyte facts.json into the consumer's repo and nothing ignored it.
      const cache = createFactsCache(root, 'fp');
      cache.set('/r/a.ts', 'hash', facts);
      cache.flush();
      expect(existsSync(join(root, CACHE_DIR, 'facts.json'))).toBe(true);
      expect(readFileSync(join(root, CACHE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    });
  });

  test('a directory an older version created without one gets one too', () => {
    inTempRoot((root) => {
      mkdirSync(join(root, CACHE_DIR), { recursive: true });
      writeFileSync(join(root, CACHE_DIR, 'facts.json'), '{}\n');
      const cache = createFactsCache(root, 'fp');
      cache.set('/r/a.ts', 'hash', facts);
      cache.flush();
      expect(readFileSync(join(root, CACHE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    });
  });

  test('a warm cache an older version wrote gains one even when nothing is rewritten', () => {
    inTempRoot((root) => {
      // Every file a cache hit: `flush` has nothing to write, and a check behind `dirty` would
      // leave a 0.2.0 cache directory showing as untracked forever. Found on a real consumer.
      const first = createFactsCache(root, 'fp');
      first.set('/r/a.ts', 'hash', facts);
      first.flush();
      rmSync(join(root, CACHE_DIR, '.gitignore'));

      const warm = createFactsCache(root, 'fp');
      expect(warm.get('/r/a.ts', 'hash')).toBeDefined();
      warm.flush();
      expect(readFileSync(join(root, CACHE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
    });
  });

  test('an existing .gitignore is never overwritten', () => {
    inTempRoot((root) => {
      mkdirSync(join(root, CACHE_DIR), { recursive: true });
      writeFileSync(join(root, CACHE_DIR, '.gitignore'), 'facts.json\n');
      const cache = createFactsCache(root, 'fp');
      cache.set('/r/a.ts', 'hash', facts);
      cache.flush();
      expect(readFileSync(join(root, CACHE_DIR, '.gitignore'), 'utf8')).toBe('facts.json\n');
    });
  });

  test('the committed half of .archcheck/ is left alone — no .gitignore above the cache', () => {
    inTempRoot((root) => {
      const cache = createFactsCache(root, 'fp');
      cache.set('/r/a.ts', 'hash', facts);
      cache.flush();
      expect(existsSync(join(root, '.archcheck', '.gitignore'))).toBe(false);
    });
  });
});

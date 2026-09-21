/**
 * The verdict cache, keyed on `(rule set hash, file content hash)`.
 *
 * What a caller must know: the RULE SET is half the key. A changed statement or a new example
 * changes the judge's answer, so a cache keyed on the file alone would serve a verdict from a rule
 * that no longer exists — which is worse than no cache, because it is invisible.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { JudgeVerdict } from './provider.js';

export const MODEL_CACHE_PATH = '.archcheck/cache/judgement.json';

type CacheFile = { schemaVersion: 1; entries: Record<string, JudgeVerdict[]> };

export type VerdictCache = {
  get(key: string): JudgeVerdict[] | undefined;
  set(key: string, verdicts: JudgeVerdict[]): void;
  flush(): void;
  readonly hits: number;
};

export function cacheKey(ruleSetHash: string, fileContent: string): string {
  return createHash('sha256')
    .update(`${ruleSetHash}\u0000${fileContent}`)
    .digest('hex')
    .slice(0, 32);
}

export function hashRuleSet(parts: readonly string[]): string {
  return createHash('sha256')
    .update([...parts].sort().join('\u0000'))
    .digest('hex')
    .slice(0, 32);
}

export function createNullVerdictCache(): VerdictCache {
  return { get: () => undefined, set: () => undefined, flush: () => undefined, hits: 0 };
}

export function createVerdictCache(root: string): VerdictCache {
  const path = join(root, MODEL_CACHE_PATH);
  let loaded: CacheFile = { schemaVersion: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CacheFile;
    if (parsed?.schemaVersion === 1 && parsed.entries) loaded = parsed;
  } catch {
    // No cache yet, or an unreadable one. Start empty rather than fail a run.
  }

  const next: CacheFile = { schemaVersion: 1, entries: {} };
  let hits = 0;
  let dirty = false;

  return {
    get(key) {
      const entry = loaded.entries[key];
      if (!entry) return undefined;
      next.entries[key] = entry;
      hits += 1;
      return entry;
    },
    set(key, verdicts) {
      next.entries[key] = verdicts;
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(next)}\n`);
      } catch {
        // A cache we cannot write is a more expensive run, not a failed one.
      }
    },
    get hits() {
      return hits;
    },
  };
}

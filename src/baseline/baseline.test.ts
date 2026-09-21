import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Diagnostic } from '../types.js';
import {
  EMPTY_BASELINE,
  identitiesOf,
  nextBaseline,
  prunedBaseline,
  readBaseline,
  staleEntries,
  writeBaseline,
} from './index.js';

const diagnostic = (identity: string, overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: 'domain-no-service-import',
  file: 'modules/ledger/domain/supersede.ts',
  evidence: {},
  identity,
  schemaVersion: 1,
  statement: 'domain may not import services',
  severity: 'error',
  confidence: 'deterministic',
  remedy: { summary: 'invert the call' },
  detectedBy: ['graph'],
  baselined: false,
  exempted: false,
  ...overrides,
});

describe('reading', () => {
  test('a repository with no baseline gets an empty one, not an error', () => {
    expect(readBaseline('/definitely/not/a/repo')).toEqual(EMPTY_BASELINE);
  });

  test('a malformed baseline is treated as empty rather than crashing a run', () => {
    const root = mkdtempSync(join(tmpdir(), 'archcheck-bl-'));
    try {
      writeBaseline(root, { version: 1, entries: [] });
      expect(readBaseline(root).entries).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('write', () => {
  test('records every current error violation', () => {
    const next = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa'), diagnostic('bbb')], '2026-09-21');
    expect(next.entries.map((e) => e.identity)).toEqual(['aaa', 'bbb']);
    expect(next.entries[0]).toMatchObject({
      ruleId: 'domain-no-service-import',
      addedAt: '2026-09-21',
      note: 'pre-existing at adoption',
    });
  });

  test('does not record warnings or advisories — the baseline is about what blocks', () => {
    const next = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('warn', { severity: 'warn' }), diagnostic('adv', { severity: 'advisory' })],
      '2026-09-21',
    );
    expect(next.entries).toEqual([]);
  });

  test('does not record an already-exempted finding — that is policy, not debt', () => {
    const next = nextBaseline(EMPTY_BASELINE, [diagnostic('x', { exempted: true })], '2026-09-21');
    expect(next.entries).toEqual([]);
  });

  test('keeps an existing entry’s addedAt, so the file stays an honest record of age', () => {
    const previous = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa')], '2025-01-01');
    const next = nextBaseline(previous, [diagnostic('aaa'), diagnostic('bbb')], '2026-09-21');
    expect(next.entries.find((e) => e.identity === 'aaa')?.addedAt).toBe('2025-01-01');
    expect(next.entries.find((e) => e.identity === 'bbb')?.addedAt).toBe('2026-09-21');
  });

  test('is sorted by identity, so a diff of the file is reviewable', () => {
    const next = nextBaseline(EMPTY_BASELINE, [diagnostic('zzz'), diagnostic('aaa')], '2026-09-21');
    expect(next.entries.map((e) => e.identity)).toEqual(['aaa', 'zzz']);
  });
});

describe('the ratchet turns one way', () => {
  test('a baselined finding that no longer reproduces is stale — this is exit 4', () => {
    const baseline = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa'), diagnostic('bbb')],
      '2026-01-01',
    );
    const stale = staleEntries(baseline, [diagnostic('aaa')]);
    expect(stale.map((e) => e.identity)).toEqual(['bbb']);
  });

  test('nothing is stale while everything still reproduces', () => {
    const baseline = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa')], '2026-01-01');
    expect(staleEntries(baseline, [diagnostic('aaa')])).toEqual([]);
  });

  test('prune drops exactly the stale entries and keeps the rest', () => {
    const baseline = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa'), diagnostic('bbb')],
      '2026-01-01',
    );
    const pruned = prunedBaseline(baseline, [diagnostic('aaa')]);
    expect(pruned.entries.map((e) => e.identity)).toEqual(['aaa']);
  });
});

describe('identitiesOf', () => {
  test('is what the normaliser consumes to set the baselined flag', () => {
    const baseline = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa')], '2026-01-01');
    expect([...identitiesOf(baseline)]).toEqual(['aaa']);
  });
});

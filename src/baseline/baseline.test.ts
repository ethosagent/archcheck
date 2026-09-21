import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  test('an entry written before occurrences existed still loads, and reads as one', () => {
    // The property that matters: no existing baseline file is invalidated by the new field.
    const root = mkdtempSync(join(tmpdir(), 'archcheck-bl-old-'));
    try {
      mkdirSync(join(root, '.archcheck'), { recursive: true });
      writeFileSync(
        join(root, '.archcheck', 'baseline.json'),
        JSON.stringify({
          version: 1,
          entries: [{ identity: 'aaa', ruleId: 'r', addedAt: '2025-01-01' }],
        }),
      );
      expect(readBaseline(root).entries[0]).toMatchObject({ identity: 'aaa', occurrences: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test('records how many occurrences collapsed into an identity', () => {
    // One identity, three empty catches. Recording 1 would let a fourth one in for free.
    const next = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa', { occurrences: 3 })],
      '2026-09-21',
    );
    expect(next.entries[0]?.occurrences).toBe(3);
  });

  test('a diagnostic with no count recorded reads as one occurrence', () => {
    const next = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa')], '2026-09-21');
    expect(next.entries[0]?.occurrences).toBe(1);
  });

  test('an existing entry’s count follows today’s reality, and keeps its addedAt', () => {
    const previous = nextBaseline(EMPTY_BASELINE, [diagnostic('aaa')], '2025-01-01');
    const next = nextBaseline(previous, [diagnostic('aaa', { occurrences: 4 })], '2026-09-21');
    expect(next.entries[0]).toMatchObject({ addedAt: '2025-01-01', occurrences: 4 });
  });

  test('an entry that did not reproduce keeps its count — a degraded --write must not shrink it', () => {
    const previous = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa', { occurrences: 3 })],
      '2025-01-01',
    );
    const next = nextBaseline(previous, [], '2026-09-21');
    expect(next.entries[0]?.occurrences).toBe(3);
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

  test('an entry recorded with more occurrences than reproduce now is stale', () => {
    // Two of three empty catches fixed: the entry no longer describes reality, so prune has work.
    const baseline = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa', { occurrences: 3 })],
      '2026-01-01',
    );
    const stale = staleEntries(baseline, [diagnostic('aaa', { occurrences: 1 })]);
    expect(stale.map((e) => e.identity)).toEqual(['aaa']);
  });

  test('a count that GREW is not stale — that is a new violation, not a fixed one', () => {
    const baseline = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa', { occurrences: 2 })],
      '2026-01-01',
    );
    expect(staleEntries(baseline, [diagnostic('aaa', { occurrences: 3 })])).toEqual([]);
  });

  test('prune reduces a surviving entry’s count rather than dropping it', () => {
    const baseline = nextBaseline(
      EMPTY_BASELINE,
      [diagnostic('aaa', { occurrences: 3 })],
      '2026-01-01',
    );
    const pruned = prunedBaseline(baseline, [diagnostic('aaa', { occurrences: 1 })]);
    expect(pruned.entries).toHaveLength(1);
    expect(pruned.entries[0]?.occurrences).toBe(1);
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

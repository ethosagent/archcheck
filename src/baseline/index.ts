/**
 * The baseline ratchet — adopting a rule on a codebase that already breaks it, without a flag day.
 *
 * What rule this enforces: the ratchet turns ONE WAY. A run fails on identities the baseline does
 * not list, and it ALSO fails (exit 4) when a listed identity no longer reproduces. Without the
 * second half the file only ever grows, silently over-suppressing forever — which is the failure
 * mode that makes baselines worthless everywhere they are used badly (plan 14).
 *
 * What a caller must know: entries are keyed by IDENTITY, never by line and never by count.
 * Because identity comes from evidence rather than position, moving the offending code neither
 * resurrects a finding nor invents a phantom one. That property is the whole reason this works,
 * and it is tested by moving a violation thirty lines down the page.
 *
 * A baseline entry is DEBT: no owner, no expiry, recorded so work can continue. An exception is a
 * deliberate allowance with both. They are different things and live in different files.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BaselineEntry, Diagnostic } from '../types.js';

export const BASELINE_PATH = '.archcheck/baseline.json';

export type Baseline = { version: 1; entries: BaselineEntry[] };

export const EMPTY_BASELINE: Baseline = { version: 1, entries: [] };

export function baselinePathFor(root: string): string {
  return join(root, BASELINE_PATH);
}

export function readBaseline(root: string): Baseline {
  try {
    const parsed: unknown = JSON.parse(readFileSync(baselinePathFor(root), 'utf8'));
    const entries = (parsed as Baseline | undefined)?.entries;
    if (!Array.isArray(entries)) return EMPTY_BASELINE;
    return {
      version: 1,
      entries: entries
        .filter(
          (entry): entry is BaselineEntry =>
            typeof entry?.identity === 'string' && typeof entry?.ruleId === 'string',
        )
        // An entry written before `occurrences` existed reads as one occurrence, so an existing
        // baseline file keeps working unchanged — 'an entry written before occurrences existed
        // still loads, and reads as one' in baseline.test.ts.
        .map((entry) => ({
          ...entry,
          occurrences:
            typeof entry.occurrences === 'number' && entry.occurrences > 0 ? entry.occurrences : 1,
        })),
    };
  } catch {
    // No baseline is the normal state for a repo that never needed one.
    return EMPTY_BASELINE;
  }
}

export function identitiesOf(baseline: Baseline): ReadonlySet<string> {
  return new Set(baseline.entries.map((entry) => entry.identity));
}

/** How many occurrences each identity has RIGHT NOW. Absent means it did not reproduce at all. */
function currentCounts(diagnostics: readonly Diagnostic[]): Map<string, number> {
  return new Map(
    diagnostics.map((diagnostic) => [diagnostic.identity, diagnostic.occurrences ?? 1]),
  );
}

/** Sorted by identity so a diff of this file is reviewable rather than a reshuffle. */
function sorted(entries: readonly BaselineEntry[]): BaselineEntry[] {
  return [...entries].sort((a, b) => a.identity.localeCompare(b.identity));
}

/**
 * `baseline --write`: record everything failing right now. Existing entries keep their original
 * `addedAt`, so the file stays an honest record of how long each piece of debt has been carried.
 */
export function nextBaseline(
  previous: Baseline,
  diagnostics: readonly Diagnostic[],
  today: string,
): Baseline {
  const kept = new Map(previous.entries.map((entry) => [entry.identity, entry]));
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'error' || diagnostic.exempted) continue;
    const existing = kept.get(diagnostic.identity);
    // An existing entry keeps its addedAt but takes today's count: `--write` records what is
    // failing right now. Only identities that REPRODUCED are touched, so a degraded run — where a
    // skipped probe reports nothing — cannot quietly rewrite a count to zero.
    kept.set(diagnostic.identity, {
      ...(existing ?? {
        identity: diagnostic.identity,
        ruleId: diagnostic.ruleId,
        addedAt: today,
        note: 'pre-existing at adoption',
      }),
      occurrences: diagnostic.occurrences ?? 1,
    });
  }
  return { version: 1, entries: sorted([...kept.values()]) };
}

/**
 * Entries that no longer describe reality. These are what exit 4 is about — and a count that has
 * come DOWN is the same news as a finding that has gone: two of three empty catches fixed leaves
 * an entry recording more debt than exists, which is exactly what `--prune` is for. A count that
 * has gone UP is the opposite news, and `src/archcheck.ts` fails the run for it instead.
 */
export function staleEntries(
  baseline: Baseline,
  diagnostics: readonly Diagnostic[],
): BaselineEntry[] {
  const current = currentCounts(diagnostics);
  return sorted(
    baseline.entries.filter((entry) => (current.get(entry.identity) ?? 0) < entry.occurrences),
  );
}

/**
 * `baseline --prune`: drop what no longer reproduces, and reduce the count of what partly does.
 * The only way the file shrinks.
 */
export function prunedBaseline(baseline: Baseline, diagnostics: readonly Diagnostic[]): Baseline {
  const current = currentCounts(diagnostics);
  return {
    version: 1,
    entries: sorted(
      baseline.entries
        .filter((entry) => current.has(entry.identity))
        .map((entry) => ({
          ...entry,
          occurrences: current.get(entry.identity) ?? entry.occurrences,
        })),
    ),
  };
}

export function writeBaseline(root: string, baseline: Baseline): string {
  const path = baselinePathFor(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return BASELINE_PATH;
}

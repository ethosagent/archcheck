/**
 * Rule ids are immutable once committed.
 *
 * What rule this enforces: LLD §1.6. A rename silently orphans every baseline entry and every
 * historical annotation that keyed off the old id — and it fails open, because the renamed rule
 * still passes. `.archcheck/ids.json` is the ledger of every id ever committed, and a load fails
 * if a listed id has vanished without a successor declaring `replaces`.
 *
 * What a caller must know: this reads a file but never writes it. `archcheck emit` owns the write,
 * so the ledger grows as a reviewed diff rather than as a side effect of running a check.
 */
import { readFileSync } from 'node:fs';
import { err, ok, type Result } from '../result.js';
import type { Rule } from '../types.js';

export type IdLedger = { schemaVersion: 1; ids: string[] };

export const ID_LEDGER_PATH = '.archcheck/ids.json';

export function readIdLedger(path: string): IdLedger {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { schemaVersion: 1, ids: [] };
    const ids = (parsed as { ids?: unknown }).ids;
    if (!Array.isArray(ids)) return { schemaVersion: 1, ids: [] };
    return { schemaVersion: 1, ids: ids.filter((id): id is string => typeof id === 'string') };
  } catch {
    // No ledger yet is the normal first-run state, not a failure.
    return { schemaVersion: 1, ids: [] };
  }
}

/** The ledger `emit` should write: every id ever seen, plus today's, sorted and deduplicated. */
export function nextIdLedger(previous: IdLedger, rules: readonly Rule[]): IdLedger {
  const ids = new Set(previous.ids);
  for (const rule of rules) ids.add(rule.id);
  return { schemaVersion: 1, ids: [...ids].sort() };
}

export function checkIdImmutability(rules: readonly Rule[], ledger: IdLedger): Result<void> {
  const present = new Set(rules.map((r) => r.id));
  const superseded = new Set(rules.map((r) => r.replaces).filter((r): r is string => Boolean(r)));

  const errors: string[] = [];
  for (const id of ledger.ids) {
    if (present.has(id) || superseded.has(id)) continue;
    errors.push(
      [
        `id disappeared: ${id}`,
        `  → either restore it, or add a rule with replaces: '${id}'`,
        '  ids are immutable because the baseline and every past annotation key off them',
      ].join('\n'),
    );
  }
  return errors.length > 0 ? err(errors) : ok(undefined);
}

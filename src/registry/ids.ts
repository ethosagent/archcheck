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

export type IdLedger = {
  schemaVersion: 1;
  ids: string[];
  /**
   * Set when a ledger file exists but could not be understood, and holds the whole message to
   * print. `checkIdImmutability` refuses to run against it, and the CLI refuses to let `emit`
   * rebuild it: an empty `ids` list would otherwise read as "no id has ever been committed",
   * which passes every rename. `tests/cli.test.ts` → 'a corrupt id ledger' pins both paths.
   */
  unreadable?: string;
};

export const ID_LEDGER_PATH = '.archcheck/ids.json';

function unreadableLedger(path: string, reason: string): IdLedger {
  return {
    schemaVersion: 1,
    ids: [],
    unreadable: [
      `the id ledger ${path} exists but could not be read: ${reason}`,
      '  → restore it from version control, or delete it and re-run `npx archcheck emit`',
      '  an empty ledger would read as "no id has ever been committed", which passes every rename',
    ].join('\n'),
  };
}

export function readIdLedger(path: string): IdLedger {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    // No ledger yet is the normal first-run state, not a failure. Anything else — a directory in
    // its place, a permission error — is one, and must not borrow the first-run answer.
    if ((error as { code?: string }).code === 'ENOENT') return { schemaVersion: 1, ids: [] };
    return unreadableLedger(path, error instanceof Error ? error.message : String(error));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return unreadableLedger(path, error instanceof Error ? error.message : String(error));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return unreadableLedger(path, 'its top level is not a JSON object');
  }
  const listed = (parsed as { ids?: unknown }).ids;
  if (!Array.isArray(listed)) return unreadableLedger(path, 'it has no `ids` array');

  const ids: string[] = [];
  for (const id of listed as readonly unknown[]) {
    // Dropping a malformed entry would silently shrink the ledger, which is the same failure as
    // not reading it at all.
    if (typeof id !== 'string')
      return unreadableLedger(path, '`ids` holds an entry that is not a string');
    ids.push(id);
  }
  return { schemaVersion: 1, ids };
}

/** The ledger `emit` should write: every id ever seen, plus today's, sorted and deduplicated. */
export function nextIdLedger(previous: IdLedger, rules: readonly Rule[]): IdLedger {
  const ids = new Set(previous.ids);
  for (const rule of rules) ids.add(rule.id);
  return { schemaVersion: 1, ids: [...ids].sort() };
}

export function checkIdImmutability(rules: readonly Rule[], ledger: IdLedger): Result<void> {
  // A ledger nobody can read proves nothing, so it fails the load rather than passing it.
  if (ledger.unreadable !== undefined) return err([ledger.unreadable]);

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

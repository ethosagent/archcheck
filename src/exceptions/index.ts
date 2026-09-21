/**
 * Exceptions — a deliberate, owned, expiring allowance, and the only legitimate way past a rule.
 *
 * What rule this enforces: exceptions live in the MANIFEST, never inline. An inline suppression
 * comment is itself a lint violation (plan 12), and this is the mechanism that makes that ban
 * reasonable rather than merely strict — people do need exceptions, and denying them a designed
 * route is how inline comments spread until nobody reviews any of them.
 *
 * Two properties make it work, and both are enforced rather than advised:
 *   1. EXPIRY IS ENFORCED. Past the date the run fails and names the owner. An exception that
 *      needs extending is a conversation, which is the point — one nobody has to re-justify is
 *      just a rule that was quietly deleted.
 *   2. ALWAYS VISIBLE. Every declared exception is reported every run, including the ones
 *      suppressing nothing. Silent exceptions decay into permanent ones.
 */
import { err, ok, type Result } from '../result.js';
import type { Diagnostic, ExceptionStatus, Rule } from '../types.js';
import { matchesAny } from '../util/glob.js';

export type ArchitectureException = {
  /** The rule id this allows past. */
  rule: string;
  /** A path glob the allowance covers. Either this or `identity` is required. */
  path?: string | string[];
  /** A single finding, pinned by its identity hash. */
  identity?: string;
  owner: string;
  /** ISO date, YYYY-MM-DD. Enforced, not advisory. */
  expires: string;
  reason: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * A REAL calendar date, not merely a regex-shaped one. `9999-99-99` and `2030-02-30` pass the shape
 * check, and an unreal date is the one way an exception never expires. The round trip catches both
 * kinds of engine: one that refuses the out-of-range day, and one that rolls it over to a different
 * date. Pinned by 'rejects an expiry that is regex-shaped but not a real calendar date'.
 */
function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Both dates are real calendar dates — `validateExceptions` refuses anything else. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

export function validateExceptions(
  exceptions: readonly ArchitectureException[],
  rules: readonly Rule[],
): Result<void> {
  const known = new Set(rules.map((rule) => rule.id));
  const errors: string[] = [];

  for (const [index, exception] of exceptions.entries()) {
    const where = `exceptions[${index}]`;
    if (typeof exception?.rule !== 'string' || !known.has(exception.rule)) {
      errors.push(`${where}: rule '${String(exception?.rule)}' is not defined in the manifest`);
    }
    if (typeof exception?.owner !== 'string' || exception.owner.trim().length === 0) {
      errors.push(`${where}: owner is required — an unowned allowance is never re-justified`);
    }
    if (typeof exception?.expires !== 'string' || !ISO_DATE.test(exception.expires)) {
      errors.push(
        `${where}: expires is required and must be YYYY-MM-DD — an allowance with no end is a rule quietly deleted`,
      );
    } else if (!isCalendarDate(exception.expires)) {
      errors.push(
        `${where}: expires '${exception.expires}' is not a real calendar date — a date that never arrives is an allowance that never expires`,
      );
    }
    if (typeof exception?.reason !== 'string' || exception.reason.trim().length === 0) {
      errors.push(`${where}: reason is required — the next reader has to be able to judge it`);
    }
    if (exception?.path === undefined && exception?.identity === undefined) {
      errors.push(`${where}: needs a path or an identity — an exception cannot cover everything`);
    }
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function covers(exception: ArchitectureException, diagnostic: Diagnostic): boolean {
  if (exception.rule !== diagnostic.ruleId) return false;
  if (exception.identity !== undefined) return exception.identity === diagnostic.identity;
  if (exception.path === undefined) return false;
  const globs = typeof exception.path === 'string' ? [exception.path] : exception.path;
  return matchesAny(globs, diagnostic.file);
}

export type AppliedExceptions = {
  diagnostics: Diagnostic[];
  statuses: ExceptionStatus[];
  /** Expired exceptions. The run fails on these, naming the owner. */
  expired: ExceptionStatus[];
};

/**
 * Mark covered diagnostics as exempted, and report the state of every declared exception.
 *
 * An EXPIRED exception suppresses nothing: the violations it used to cover come back, and the
 * expiry itself is reported so the failure names a person rather than only a file.
 */
export function applyExceptions(
  exceptions: readonly ArchitectureException[],
  diagnostics: readonly Diagnostic[],
  today: string = todayIso(),
): AppliedExceptions {
  // ONE mechanism for both halves. Suppression used to compare the ISO strings while expiry parsed
  // them, so `expires: '9999-99-99'` suppressed forever and reported NaN days left — property 1 of
  // this module, silently untrue. Both now ask this predicate, so they cannot disagree. Written as
  // `!(… >= 0)` so an unparseable date reads as EXPIRED rather than as a permanent allowance; only
  // a caller bypassing `validateExceptions` can produce one. Pinned by 'suppression and expiry are
  // one mechanism, so they never disagree'.
  const isExpired = (exception: ArchitectureException): boolean =>
    !(daysBetween(today, exception.expires) >= 0);

  const counts = new Map<number, number>();
  const marked = diagnostics.map((diagnostic) => {
    const index = exceptions.findIndex(
      (exception) => !isExpired(exception) && covers(exception, diagnostic),
    );
    if (index === -1) return diagnostic;
    counts.set(index, (counts.get(index) ?? 0) + 1);
    return { ...diagnostic, exempted: true };
  });

  const statuses = exceptions.map((exception, index): ExceptionStatus => {
    const daysLeft = daysBetween(today, exception.expires);
    return {
      ruleId: exception.rule,
      owner: exception.owner,
      expires: exception.expires,
      // The expiry date itself is the last day it holds, so "expired" means strictly past it.
      expired: isExpired(exception),
      daysLeft,
      reason: exception.reason,
      suppressed: counts.get(index) ?? 0,
    };
  });

  return { diagnostics: marked, statuses, expired: statuses.filter((s) => s.expired) };
}

export function describeExpired(expired: readonly ExceptionStatus[]): string[] {
  return expired.flatMap((status) => [
    `exception expired ${status.expires} (${-status.daysLeft} day(s) ago): ${status.ruleId}`,
    `  owner: ${status.owner} — ${status.reason}`,
    '  → extend it with a new date and a re-stated reason, or fix the violations and remove it',
  ]);
}

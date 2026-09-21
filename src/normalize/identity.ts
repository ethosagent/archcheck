/**
 * The identity hash — archcheck's contract with the future.
 *
 * What rule this enforces: baselining, deduplication and "did my fix work" all key off this one
 * string. It is computed from the ruleId plus the SEMANTIC evidence, and it contains
 * **no line, no column, and no absolute path**. Moving a function must not produce a new identity,
 * or the baseline ratchet becomes noise and people stop trusting it — at which point the ratchet
 * gets deleted and no rule can ever be adopted on existing code again (LLD §1.4, plan 07).
 *
 * What a caller must know: `canonicalJson` sorts keys at every depth, so two probes that build the
 * same evidence object in a different order agree. Any path put into evidence must already be
 * repo-relative POSIX — `repoRelative()` is not applied here, because silently rewriting evidence
 * would hide the mistake rather than surface it.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const IDENTITY_LENGTH = 16;

export function computeIdentity(ruleId: string, evidence: Record<string, unknown>): string {
  return createHash('sha256')
    .update([ruleId, canonicalJson(evidence)].join('\u0000'))
    .digest('hex')
    .slice(0, IDENTITY_LENGTH);
}

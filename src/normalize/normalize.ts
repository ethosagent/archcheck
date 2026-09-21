/**
 * RawFinding + Rule → Diagnostic. The single place a finding becomes something an agent can act on.
 *
 * What rule this enforces: the normaliser NEVER drops a finding. A finding whose ruleId is not in
 * the registry is an error, not a silent skip — it means an emitted config has drifted from the
 * manifest, which is precisely the failure the whole emit pipeline exists to prevent (plan 07).
 *
 * What a caller must know: it only ever ADDS. `Diagnostic extends RawFinding`, and nothing here
 * rewrites what a probe observed, so probe output stays auditable against the diagnostic a person
 * finally reads.
 */
import { err, ok, type Result } from '../result.js';
import type { Diagnostic, RawFinding, Remedy, Rule } from '../types.js';
import { SCHEMA_VERSION } from '../version.js';
import { computeIdentity } from './identity.js';

export type NormalizeInput = {
  findings: readonly RawFinding[];
  /** The probe that produced them. Becomes `detectedBy`. */
  detectedBy: string;
};

export type NormalizeOptions = {
  byId(id: string): Rule | undefined;
  /** Identities already recorded in the baseline. Set here, consumed by the reporters. */
  baselined?: ReadonlySet<string>;
  /**
   * Injected per-finding sharpening, wired by the facade to the contract kinds. The normaliser
   * does not know what a `layers` rule is, and must not learn — this is the seam that lets one rule
   * say different things about findings that need different fixes.
   */
  refine?(finding: RawFinding, rule: Rule): { statement?: string; remedy?: Remedy } | undefined;
};

/**
 * Two probes may legitimately observe the same violation — the graph sees the edge, lint sees the
 * statement. Same identity, one diagnostic, `detectedBy` becomes the union.
 */
function merge(existing: Diagnostic, incoming: Diagnostic): Diagnostic {
  const detectedBy = [...new Set([...existing.detectedBy, ...incoming.detectedBy])].sort();
  // Keep the more precise position if one probe has it and the other does not.
  return {
    ...existing,
    detectedBy,
    line: existing.line ?? incoming.line,
    col: existing.col ?? incoming.col,
    endLine: existing.endLine ?? incoming.endLine,
    // The count is the HIGHEST any single probe saw, never the sum: two probes each seeing this
    // violation once is one violation, not two ('two probes observing ONE violation is one
    // occurrence, not two' in normalize.test.ts), while three empty catches reported by one probe
    // really are three ('several occurrences in one file collapse to ONE diagnostic that counts
    // them'). Neither number reaches `evidence`, so the identity hash is untouched.
    occurrences: Math.max(existing.occurrences ?? 1, incoming.occurrences ?? 1),
    occurrenceLines: [
      ...new Set([...(existing.occurrenceLines ?? []), ...(incoming.occurrenceLines ?? [])]),
    ].sort((a, b) => a - b),
  };
}

export function normalize(
  inputs: readonly NormalizeInput[],
  options: NormalizeOptions,
): Result<Diagnostic[]> {
  const baselined = options.baselined ?? new Set<string>();
  const byIdentity = new Map<string, Diagnostic>();
  const unknown = new Map<string, Set<string>>();
  /** `identity\u0000probe` → how many findings THAT probe reported for it. See `merge`. */
  const seenByProbe = new Map<string, number>();

  for (const input of inputs) {
    for (const finding of input.findings) {
      const rule = options.byId(finding.ruleId);
      if (!rule) {
        const probes = unknown.get(finding.ruleId) ?? new Set<string>();
        probes.add(input.detectedBy);
        unknown.set(finding.ruleId, probes);
        continue;
      }

      const identity =
        finding.identity.length > 0
          ? finding.identity
          : computeIdentity(finding.ruleId, finding.evidence);

      const probeKey = `${identity}\u0000${input.detectedBy}`;
      const seen = (seenByProbe.get(probeKey) ?? 0) + 1;
      seenByProbe.set(probeKey, seen);

      const refinement = options.refine?.(finding, rule);
      const diagnostic: Diagnostic = {
        ...finding,
        identity,
        schemaVersion: SCHEMA_VERSION,
        statement: refinement?.statement ?? rule.statement,
        severity: rule.severity,
        confidence: rule.confidence,
        remedy: refinement?.remedy ?? rule.remedy,
        detectedBy: [input.detectedBy],
        occurrences: seen,
        occurrenceLines: finding.line === undefined ? [] : [finding.line],
        baselined: baselined.has(identity),
        // Set by applyExceptions() once today's date is known, which the normaliser has no
        // business knowing. Debt and policy are decided in different places on purpose.
        exempted: false,
      };

      const existing = byIdentity.get(identity);
      byIdentity.set(identity, existing ? merge(existing, diagnostic) : diagnostic);
    }
  }

  if (unknown.size > 0) {
    return err(
      [...unknown.entries()].map(
        ([ruleId, probes]) =>
          `${[...probes].sort().join(', ')} reported rule '${ruleId}', which the manifest does not define\n` +
          '  → an emitted config has drifted from the manifest: run `archcheck emit`',
      ),
    );
  }

  // Deterministic order: by file, then by line, then by identity. A reporter must not have to sort.
  const diagnostics = [...byIdentity.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.identity.localeCompare(b.identity),
  );
  return ok(diagnostics);
}

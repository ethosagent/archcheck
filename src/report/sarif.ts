/**
 * The SARIF reporter — the CI and editor format.
 *
 * Why this and not our own shape: code scanning, editor viewers and run-to-run diffing all consume
 * SARIF natively. Writing it once is cheaper than any one of those integrations (LLD §1.10).
 *
 * What rule this enforces: the PROPERTIES BAG carries what SARIF has no field for — confidence,
 * the identity hash, the remedy, and whether a finding is baselined or exempted. Anything reading
 * plain SARIF still gets file, line, rule and message, so nothing is lost either way.
 *
 * Severity mapping is opinionated and deliberate:
 *   error → error · warn → warning · advisory → note
 * A model verdict therefore lands as a `note` in CI whatever its rule severity says, which is the
 * advisory-by-default policy expressed where CI can actually see it.
 */
import type { Confidence, Diagnostic, RunResult, Severity } from '../types.js';
import type { ReportCtx, Reporter } from './types.js';
import { visible } from './types.js';

export const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

type SarifLevel = 'error' | 'warning' | 'note' | 'none';

const BY_SEVERITY: Record<Severity, SarifLevel> = {
  error: 'error',
  warn: 'warning',
  advisory: 'note',
  off: 'none',
};

/**
 * A MODEL verdict is never worse than a note, whatever its rule severity says. Promoting a
 * judgement rule to `error` is allowed — it is policy — but a non-deterministic gate that blocks
 * CI is how a check suite loses trust, so the ceiling is applied here, where CI can see it.
 */
function levelFor(severity: Severity, confidence: Confidence): SarifLevel {
  const level = BY_SEVERITY[severity];
  if (confidence !== 'model') return level;
  return level === 'error' || level === 'warning' ? 'note' : level;
}

function ruleDescriptorsFor(diagnostics: readonly Diagnostic[]) {
  const byRule = new Map<string, Diagnostic>();
  for (const diagnostic of diagnostics) {
    if (!byRule.has(diagnostic.ruleId)) byRule.set(diagnostic.ruleId, diagnostic);
  }
  return [...byRule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ruleId, diagnostic]) => ({
      id: ruleId,
      name: ruleId,
      shortDescription: { text: diagnostic.statement },
      fullDescription: { text: `${diagnostic.statement} — ${diagnostic.remedy.summary}` },
      help: {
        text: diagnostic.remedy.summary,
        ...(diagnostic.remedy.docs === undefined
          ? {}
          : { markdown: `[docs](${diagnostic.remedy.docs})` }),
      },
      defaultConfiguration: { level: levelFor(diagnostic.severity, diagnostic.confidence) },
      properties: {
        confidence: diagnostic.confidence,
        ...(diagnostic.remedy.allowed === undefined ? {} : { allowed: diagnostic.remedy.allowed }),
      },
    }));
}

export function toSarif(result: RunResult, ctx: ReportCtx): Record<string, unknown> {
  // Baselined and exempted findings are INCLUDED here, marked rather than dropped. CI is where a
  // reviewer looks at suppressed debt, and a format that hides it makes the suppression invisible.
  const diagnostics = visible(result, { ...ctx, showBaselined: true });

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'archcheck',
            informationUri: 'https://github.com/miteshsharma/archcheck',
            rules: ruleDescriptorsFor(diagnostics),
          },
        },
        results: diagnostics.map((diagnostic) => ({
          ruleId: diagnostic.ruleId,
          level: levelFor(diagnostic.severity, diagnostic.confidence),
          message: { text: `${diagnostic.statement} — ${diagnostic.remedy.summary}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: diagnostic.file },
                ...(diagnostic.line === undefined
                  ? {}
                  : {
                      region: {
                        startLine: diagnostic.line,
                        ...(diagnostic.col === undefined ? {} : { startColumn: diagnostic.col }),
                        ...(diagnostic.endLine === undefined
                          ? {}
                          : { endLine: diagnostic.endLine }),
                      },
                    }),
              },
            },
          ],
          // A suppressed finding is reported to SARIF as suppressed, which is the field consumers
          // already understand — rather than being silently absent.
          ...(diagnostic.baselined || diagnostic.exempted
            ? {
                suppressions: [
                  {
                    kind: 'external',
                    justification: diagnostic.exempted
                      ? 'covered by a declared exception in architecture.config.ts'
                      : 'recorded in .archcheck/baseline.json as pre-existing',
                  },
                ],
              }
            : {}),
          partialFingerprints: { archcheckIdentity: diagnostic.identity },
          properties: {
            confidence: diagnostic.confidence,
            severity: diagnostic.severity,
            identity: diagnostic.identity,
            detectedBy: diagnostic.detectedBy,
            baselined: diagnostic.baselined,
            exempted: diagnostic.exempted,
            // SARIF has no field for "this result stands for N of the same thing", so the count
            // and its lines ride in the properties bag like our other extras.
            occurrences: diagnostic.occurrences ?? 1,
            occurrenceLines: diagnostic.occurrenceLines ?? [],
            remedy: diagnostic.remedy,
            evidence: diagnostic.evidence,
          },
        })),
        invocations: [
          {
            executionSuccessful: result.ok,
            properties: {
              coverage: result.coverage,
              skipped: result.skipped,
              baselineStale: result.baselineStale,
              exceptions: result.exceptions,
            },
          },
        ],
      },
    ],
  };
}

export function createSarifReporter(): Reporter {
  return {
    name: 'sarif',
    async report(result: RunResult, ctx: ReportCtx): Promise<string> {
      return `${JSON.stringify(toSarif(result, ctx), null, 2)}\n`;
    },
  };
}

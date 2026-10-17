/**
 * Coverage, computed — never claimed.
 *
 * What rule this enforces: the percentage comes from counting the manifest at run time. Add a rule
 * with no real check and the judgement count rises and the percentage falls, in the same commit,
 * with no way to write a nicer number by hand (plan 19). That number is worth watching precisely
 * because nobody can edit it.
 *
 * What a caller must know: `rules.json` is DATA, not HTML. The document reads it. That keeps
 * archcheck independent of anyone's doc format and makes the same data available to a dashboard
 * later without a second emitter.
 */
import type { Coverage, CoveredBy, Rule } from '../types.js';

export const RULES_JSON = 'rules.json';

/** The mark each tier gets in a document, matching the patterns document's own vocabulary. */
export const MARK = { deterministic: '✓', proxy: '◑', model: '○' } as const;

export type RuleSummary = {
  id: string;
  kind: string;
  statement: string;
  severity: string;
  confidence: string;
  mark: string;
  remedy: string;
  /**
   * Where the rule is enforced, when it says so. Present only on the rules that declare it, so a
   * reader can see which tests hold a proxy rule up — and notice when one is deleted.
   */
  coveredBy?: CoveredBy;
};

export type RulesDocument = {
  schemaVersion: 1;
  coverage: Coverage & { automatable: number };
  rules: RuleSummary[];
};

/**
 * `deterministic + proxy` over the TOTAL: the share a machine decides without a model.
 *
 * The denominator is every active rule, including the ones nothing checks. Declare a rule of a
 * kind archcheck has not implemented and the percentage falls, which is the whole point of
 * computing this number rather than writing it down.
 */
export function automatablePercent(coverage: Coverage): number {
  if (coverage.total === 0) return 0;
  return Math.round(((coverage.deterministic + coverage.proxy) / coverage.total) * 100);
}

export function rulesDocument(rules: readonly Rule[], coverage: Coverage): RulesDocument {
  return {
    schemaVersion: 1,
    coverage: { ...coverage, automatable: automatablePercent(coverage) },
    rules: rules
      .filter((rule) => rule.severity !== 'off')
      .map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        statement: rule.statement,
        severity: rule.severity,
        confidence: rule.confidence,
        mark: MARK[rule.confidence],
        remedy: rule.remedy.summary,
        ...(rule.coveredBy === undefined ? {} : { coveredBy: rule.coveredBy }),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export const FENCE_BEGIN = '<!-- archcheck:begin rules-table -->';
export const FENCE_END = '<!-- archcheck:end rules-table -->';

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/** The generated region: the rule table and the counts. Prose stays hand-written. */
export function renderRulesTable(document: RulesDocument): string {
  const { coverage } = document;
  // The column appears only when something fills it. A manifest with no `coveredBy` keeps the
  // table it has today, byte for byte, so adding the feature changes nobody's generated output.
  const covered = document.rules.some((rule) => rule.coveredBy !== undefined);
  const head = covered
    ? '| | Rule | Statement | Kind | Severity | Covered by |'
    : '| | Rule | Statement | Kind | Severity |';
  const rule1 = covered ? '|---|---|---|---|---|---|' : '|---|---|---|---|---|';
  const lines = [
    FENCE_BEGIN,
    '',
    `**${coverage.total} rules** · ${MARK.deterministic} ${coverage.deterministic} deterministic · ` +
      `${MARK.proxy} ${coverage.proxy} proxy · ${MARK.model} ${coverage.model} judgement · ` +
      `**${coverage.automatable}% automatable**`,
    '',
    head,
    rule1,
    ...document.rules.map((rule) => {
      const cells = [
        rule.mark,
        `\`${rule.id}\``,
        escapeCell(rule.statement),
        rule.kind,
        rule.severity,
      ];
      if (covered) {
        cells.push(
          rule.coveredBy === undefined
            ? ''
            : escapeCell(rule.coveredBy.tests.map((test) => `\`${test}\``).join(', ')),
        );
      }
      return `| ${cells.join(' | ')} |`;
    }),
    '',
    FENCE_END,
  ];
  return lines.join('\n');
}

/**
 * Replace the fenced region, idempotently. Returns undefined when the document has no fence —
 * a document that never asked for a generated region must not grow one by surprise.
 */
export function replaceFencedRegion(source: string, replacement: string): string | undefined {
  const start = source.indexOf(FENCE_BEGIN);
  const end = source.indexOf(FENCE_END);
  if (start === -1 || end === -1 || end < start) return undefined;
  return source.slice(0, start) + replacement + source.slice(end + FENCE_END.length);
}

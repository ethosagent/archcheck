/**
 * The `judgement` kind — rules in plain English, with enough structure to be checkable.
 *
 * What rule this enforces, and why each field is REQUIRED rather than optional:
 *
 * - `examples` are the quality lever. A rule with a sentence and no examples flags everything,
 *   people stop reading the advisory stream, and the whole tier dies. The validator refuses to
 *   load one, which is the only moment anybody is willing to write examples.
 * - `cite` forces falsifiability. The model must return the span it judged, and a verdict with no
 *   citation is discarded by the probe. That removes most confident-sounding noise for free.
 *
 * Severity is POLICED, not forced. Setting a judgement rule to `error` is allowed — it is policy,
 * not a type constraint — but it emits a warning naming the rule, so promoting one is a visible
 * act rather than a quiet default. `confidence` is forced to `model` regardless of what the
 * manifest says, because a judgement rule is not deterministic however it is labelled.
 */
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { matchesAny } from '../util/glob.js';
import type { ContractType, EmitCtx, ExplainCtx, ValidateCtx } from './types.js';

export type JudgementParams = {
  /** One sentence, in plain English, that a reader and a model both understand. */
  statement: string;
  appliesTo: string | string[];
  examples: {
    /** Code that must NOT be flagged. At least one. */
    pass: string[];
    /** Code that MUST be flagged. At least one. */
    fail: string[];
  };
  /** What the model must quote back to justify a verdict, e.g. 'the offending statement'. */
  cite: string;
};

export function asJudgementParams(rule: Rule): JudgementParams {
  return rule.params as unknown as JudgementParams;
}

export function judgementApplies(params: JudgementParams, relativePath: string): boolean {
  const globs = typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo;
  return matchesAny(globs, relativePath);
}

/** `confidence` is not the manifest's to decide for this kind. */
export function effectiveConfidence(): 'model' {
  return 'model';
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof params.statement !== 'string' || params.statement.trim().length === 0) {
    errors.push('params.statement is required — the rule in one plain-English sentence');
  }

  const appliesTo = params.appliesTo;
  const globs = typeof appliesTo === 'string' ? [appliesTo] : appliesTo;
  if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === 'string')) {
    errors.push('params.appliesTo is required — a path glob, or a list of them');
  }

  const examples = params.examples as { pass?: unknown; fail?: unknown } | undefined;
  const isNonEmptyStrings = (value: unknown) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && v.trim().length > 0);

  if (!isNonEmptyStrings(examples?.pass)) {
    errors.push(
      'params.examples.pass is required — at least one example that must NOT be flagged. ' +
        'A judgement rule with no examples flags everything, and the advisory stream dies',
    );
  }
  if (!isNonEmptyStrings(examples?.fail)) {
    errors.push(
      'params.examples.fail is required — at least one example that MUST be flagged. ' +
        'Without it nothing proves the rule can fire',
    );
  }

  if (typeof params.cite !== 'string' || params.cite.trim().length === 0) {
    errors.push(
      'params.cite is required — what the model must quote to justify a verdict. ' +
        'A verdict with no citation is discarded, which is what keeps this tier honest',
    );
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

/** Policed at load: allowed, but never quiet. */
function warnAboutRule(rule: Rule): string[] {
  const warnings: string[] = [];
  if (rule.severity === 'error' || rule.severity === 'warn') {
    warnings.push(
      `${rule.id}: a judgement rule at severity '${rule.severity}' can block a build on a ` +
        'non-deterministic verdict. That is allowed — it is policy — but it is the fastest way ' +
        "for a check suite to lose trust. The default is 'advisory'.",
    );
  }
  if (rule.confidence !== 'model') {
    warnings.push(
      `${rule.id}: confidence '${rule.confidence}' is ignored for a judgement rule — it is always 'model'.`,
    );
  }
  return warnings;
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asJudgementParams(rule);
  return [
    {
      // The model sink: what the judge reads. Emitted so the prompt is reviewable as a committed
      // artefact rather than assembled invisibly at run time.
      target: 'test',
      ruleId: rule.id,
      content: {
        judge: true,
        statement: params.statement,
        files: typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo,
        examples: params.examples,
        cite: params.cite,
        message: `${rule.statement} — ${rule.remedy.summary}`,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  return [
    rule.statement,
    `  ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`,
    `  cited: ${String(evidence.cited ?? '')}`,
    `  the judge said: ${String(evidence.reason ?? '')}`,
    `  → ${rule.remedy.summary}`,
    '  (advisory: a model decided this, so treat it as a prompt to look, not a verdict)',
  ].join('\n');
}

export const judgementContract: ContractType = {
  kind: 'judgement',
  validate: validateParams,
  warn: warnAboutRule,
  emit: emitFragments,
  explain: explainFinding,
};

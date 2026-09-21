/**
 * The `required-file` kind — rules about what must EXIST.
 *
 * What this covers that a graph cannot see: every port has a memory twin, every primitive has a
 * story, every error-severity rule has a fixture. Existence is the rule; the content of the
 * required file is deliberately out of scope, because "a file is there" is decidable and "the file
 * is any good" is not.
 *
 * The self-referential case is the important one (plan 16):
 *
 *   { forEach: 'rule[severity=error]', expect: 'fixtures/rules/{id}.violation.ts' }
 *
 * A rule that cannot catch a deliberate violation passes every build and looks exactly like
 * compliance. This is the rule that catches that, and it is why "test the checker" stops being
 * discipline and becomes a gate.
 */
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type RequiredFileParams = {
  /** A path glob, or a registry selector like `rule[severity=error]`. */
  forEach: string;
  /**
   * A path template. `{id}` for a rule; for a file, `{dir}`, `{name}`, `{base}`, `{ext}` and
   * `{Base}` — the base with its first letter capitalised, which is what the twin convention
   * `blobStore.ts` → `memoryBlobStore.ts` actually needs.
   */
  expect: string;
};

export function asRequiredFileParams(rule: Rule): RequiredFileParams {
  return rule.params as unknown as RequiredFileParams;
}

const RULE_SELECTOR = /^rule\[([a-z]+)=([a-z-]+)\]$/;

export function isRuleSelector(forEach: string): boolean {
  return RULE_SELECTOR.test(forEach);
}

/** One thing that must have a companion file. */
export type RequiredSubject = {
  /** The file the finding is reported AGAINST — the subject that lacks the companion. */
  subject: string;
  /** What is missing. */
  expected: string;
  /** For evidence and for the message. */
  label: string;
};

function expandForFile(template: string, path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  return template
    .replaceAll('{dir}', dir)
    .replaceAll('{name}', name)
    .replaceAll('{Base}', base.charAt(0).toUpperCase() + base.slice(1))
    .replaceAll('{base}', base)
    .replaceAll('{ext}', ext);
}

/**
 * A layers rule whose allow-list is `'*'` declares SCOPE rather than constraining anything — it
 * can never produce a finding, so demanding a fixture for it would be demanding a file that
 * cannot contain a violation. Derived from the rule's own params, not an exemption list.
 */
function canEverFire(rule: Rule): boolean {
  if (rule.kind !== 'layers') return true;
  return (rule.params as { mayImport?: unknown }).mayImport !== '*';
}

export function subjectsFor(
  params: RequiredFileParams,
  ctx: { rules: readonly Rule[]; files: readonly string[] },
): RequiredSubject[] {
  const selector = RULE_SELECTOR.exec(params.forEach);
  if (selector) {
    const [, field, value] = selector;
    return ctx.rules
      .filter(
        (rule) => String((rule as unknown as Record<string, unknown>)[field as string]) === value,
      )
      .filter(canEverFire)
      .map((rule) => ({
        subject: rule.id,
        expected: params.expect.replaceAll('{id}', rule.id),
        label: `rule '${rule.id}'`,
      }));
  }

  return ctx.files.map((file) => ({
    subject: file,
    expected: expandForFile(params.expect, file),
    label: file,
  }));
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof params.forEach !== 'string' || params.forEach.length === 0) {
    errors.push(
      "params.forEach is required — a path glob, or a selector like 'rule[severity=error]'",
    );
  }
  if (typeof params.expect !== 'string' || params.expect.length === 0) {
    errors.push('params.expect is required — the path template the companion file must be at');
  }
  if (typeof params.forEach === 'string' && typeof params.expect === 'string') {
    if (isRuleSelector(params.forEach) && !params.expect.includes('{id}')) {
      errors.push(
        'params.expect must contain {id} when forEach iterates rules, or every rule expects the same one file',
      );
    }
    if (!isRuleSelector(params.forEach) && !/\{(dir|base|Base|name|ext)\}/.test(params.expect)) {
      errors.push(
        'params.expect must contain {dir}, {base}, {name} or {ext} when forEach iterates files, ' +
          'or every file expects the same one companion',
      );
    }
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asRequiredFileParams(rule);
  return [
    {
      target: 'test',
      ruleId: rule.id,
      content: {
        forEach: params.forEach,
        expect: params.expect,
        message: `${rule.statement} — ${rule.remedy.summary}`,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  return [
    `${String(evidence.label)} has no ${String(evidence.expected)}`,
    `  expected at: ${String(evidence.expected)}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  return {
    statement: `${String(evidence.label)} is missing ${String(evidence.expected)}`,
    remedy: rule.remedy,
  };
}

export const requiredFileContract: ContractType = {
  kind: 'required-file',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

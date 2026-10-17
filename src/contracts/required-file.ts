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
import { dirGlobOf, dirsOf, expandForDir, isDirSelector } from './requiredDirs.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type RequiredFileParams = {
  /**
   * A path glob, a registry selector like `rule[severity=error]`, or a directory selector like
   * `dir[packages/*]`. Iterating files reports one finding per file, which for a per-directory
   * requirement says the same thing once for every file in the directory.
   */
  forEach: string;
  /**
   * A path template. `{id}` for a rule; `{dir}`, `{dirname}` and `{parent}` for a directory; for
   * a file, `{dir}`, `{name}`, `{base}`, `{ext}` and `{Base}` — the base with its first letter
   * capitalised, which is what the twin convention `blobStore.ts` → `memoryBlobStore.ts` needs.
   *
   * Optional only with `mustNotExist`, where the matched path is its own expectation.
   */
  expect?: string;
  /**
   * Invert the question. Without it a subject with no companion is the finding; with it, every
   * subject that EXISTS is the finding — "there is no `src/utils/` dumping ground", "no `.env` is
   * committed". The subject list is unchanged; only which answer is a violation moves.
   */
  mustNotExist?: boolean;
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
 * A layers rule whose allow-list is `'*'` declares SCOPE rather than constraining anything, so it
 * cannot produce an edge violation and demanding a fixture for it would demand a file that cannot
 * contain one. Derived from the rule's own params, never an exemption list.
 *
 * `catchesUnlayered` is the exception, and it matters: a rule that owns the unlayered-file report
 * CAN fire — on a folder nobody declared — even when its allow-list is `'*'`. Missing that would
 * have quietly excused the one rule in a manifest most worth proving.
 */
function canEverFire(rule: Rule): boolean {
  if (rule.kind !== 'layers') return true;
  const params = rule.params as { mayImport?: unknown; catchesUnlayered?: unknown };
  if (params.catchesUnlayered === true) return true;
  return params.mayImport !== '*';
}

export function subjectsFor(
  params: RequiredFileParams,
  ctx: { rules: readonly Rule[]; files: readonly string[] },
): RequiredSubject[] {
  const selector = RULE_SELECTOR.exec(params.forEach);
  if (selector) {
    const [, field, value] = selector;
    // Validation guarantees `expect` for a rule selector, so the fallback is unreachable.
    const template = params.expect ?? '';
    return ctx.rules
      .filter(
        (rule) => String((rule as unknown as Record<string, unknown>)[field as string]) === value,
      )
      .filter(canEverFire)
      .map((rule) => ({
        subject: rule.id,
        expected: template.replaceAll('{id}', rule.id),
        label: `rule '${rule.id}'`,
      }));
  }

  const dirGlob = dirGlobOf(params.forEach);
  if (dirGlob !== undefined) {
    // One subject per directory, not per file. The whole point: a directory with forty files that
    // lacks a README is one missing README, not forty.
    return dirsOf(dirGlob, ctx.files).map((dir) => ({
      subject: dir,
      expected: params.expect === undefined ? dir : expandForDir(params.expect, dir),
      label: `directory '${dir}'`,
    }));
  }

  return ctx.files.map((file) => ({
    subject: file,
    expected: params.expect === undefined ? file : expandForFile(params.expect, file),
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
  const mustNotExist = params.mustNotExist;
  if (mustNotExist !== undefined && typeof mustNotExist !== 'boolean') {
    errors.push('params.mustNotExist must be true or false when given');
  }
  // `expect` is what a subject is checked FOR, so it is required — except under mustNotExist,
  // where the matched path is its own expectation and a template would be asking for a second one.
  if (mustNotExist !== true && (typeof params.expect !== 'string' || params.expect.length === 0)) {
    errors.push('params.expect is required — the path template the companion file must be at');
  }
  if (mustNotExist === true && isRuleSelector(params.forEach as string)) {
    errors.push(
      'params.mustNotExist cannot iterate rules — it reports paths that exist, and a rule is ' +
        'not a path. Point forEach at a glob, or at dir[...]',
    );
  }
  if (typeof params.forEach === 'string' && typeof params.expect === 'string') {
    const dir = isDirSelector(params.forEach);
    const rules = isRuleSelector(params.forEach);
    if (rules && !params.expect.includes('{id}')) {
      errors.push(
        'params.expect must contain {id} when forEach iterates rules, or every rule expects the same one file',
      );
    }
    if (dir && !/\{(dir|dirname|parent)\}/.test(params.expect)) {
      errors.push(
        'params.expect must contain {dir}, {dirname} or {parent} when forEach iterates ' +
          'directories, or every directory expects the same one file',
      );
    }
    // The message a reader needs is which placeholders this forEach actually offers. Saying only
    // "unknown placeholder" would leave them guessing which form they are in.
    const wrongForm = !dir && !rules && /\{(dirname|parent)\}/.test(params.expect);
    if (wrongForm) {
      errors.push(
        'params.expect uses {dirname} or {parent}, which only a directory-iterating rule ' +
          'offers — write forEach as dir[<glob>], or use {dir}, {base}, {name} or {ext}',
      );
    }
    // Suppressed when the message above already fired. Both describe the same single defect,
    // and the generic one would tell an author who DID write a placeholder to write one.
    if (!dir && !rules && !wrongForm && !/\{(dir|base|Base|name|ext)\}/.test(params.expect)) {
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
        ...(params.expect === undefined ? {} : { expect: params.expect }),
        ...(params.mustNotExist === true ? { mustNotExist: true } : {}),
        message: `${rule.statement} — ${rule.remedy.summary}`,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  if (evidence.mustNotExist === true) {
    return [
      `${String(evidence.expected)} exists, and this rule says it must not`,
      `  → ${rule.remedy.summary}`,
    ].join('\n');
  }
  return [
    `${String(evidence.label)} has no ${String(evidence.expected)}`,
    `  expected at: ${String(evidence.expected)}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  if (evidence.mustNotExist === true) {
    return {
      statement: `${String(evidence.expected)} must not exist`,
      remedy: rule.remedy,
    };
  }
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

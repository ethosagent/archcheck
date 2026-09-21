/**
 * The `naming` kind. Thirty-one of the ninety-one rules land in this kind and the next, which makes
 * these two the highest coverage per unit of work in the whole plan set (plan 12).
 *
 * What rule this enforces: hook `use` prefix, twin factories (`createMemory*`), selectors
 * (`select*`), boolean prefixes, filenames, test-id casing. All of them are "this name must look
 * like this", so all of them are one kind.
 *
 * What a caller must know: `appliesTo` is a path GLOB (which files this rule looks at) and
 * `pattern` is a REGULAR EXPRESSION (what the name must look like). Two different jobs, so two
 * different languages — a glob cannot say "camelCase", and a regex over paths reads badly.
 * `remedy.autofix` stays false: renaming an export is a change to every caller.
 */
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { matchesAny } from '../util/glob.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

/** What is being named. */
export type NamingTarget = 'files' | 'exports' | 'both';

export type NamingParams = {
  /** Path globs. A leading `!` excludes, so entry points can be carved out. */
  appliesTo: string | string[];
  target?: NamingTarget;
  /** A regular expression the name must match. */
  pattern?: string;
  /** Sugar for the commonest case: the name must start with one of these. */
  prefixes?: string[];
};

export function asNamingParams(rule: Rule): NamingParams {
  return rule.params as unknown as NamingParams;
}

export function appliesToGlobs(appliesTo: string | string[]): string[] {
  return typeof appliesTo === 'string' ? [appliesTo] : appliesTo;
}

export function namingApplies(params: NamingParams, relativePath: string): boolean {
  return matchesAny(appliesToGlobs(params.appliesTo), relativePath);
}

/** True when the name is acceptable. */
export function nameIsWellFormed(params: NamingParams, name: string): boolean {
  if (params.prefixes && params.prefixes.length > 0) {
    if (params.prefixes.some((prefix) => name.startsWith(prefix))) return true;
    if (params.pattern === undefined) return false;
  }
  if (params.pattern === undefined) return true;
  return new RegExp(params.pattern).test(name);
}

export function describeExpectation(params: NamingParams): string {
  const parts: string[] = [];
  if (params.prefixes && params.prefixes.length > 0) {
    parts.push(`start with ${params.prefixes.map((p) => `'${p}'`).join(' or ')}`);
  }
  if (params.pattern !== undefined) parts.push(`match /${params.pattern}/`);
  return parts.join(', or ');
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  const appliesTo = params.appliesTo;
  const globs = typeof appliesTo === 'string' ? [appliesTo] : appliesTo;
  if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === 'string')) {
    errors.push('params.appliesTo is required — a path glob, or a list of them');
  }

  if (
    params.target !== undefined &&
    !['files', 'exports', 'both'].includes(String(params.target))
  ) {
    errors.push(
      `params.target must be files | exports | both (got ${JSON.stringify(params.target)})`,
    );
  }

  const hasPattern = typeof params.pattern === 'string' && params.pattern.length > 0;
  const hasPrefixes = Array.isArray(params.prefixes) && params.prefixes.length > 0;
  if (!hasPattern && !hasPrefixes) {
    errors.push('params needs a pattern or prefixes — a naming rule with neither matches nothing');
  }
  if (hasPattern) {
    try {
      new RegExp(params.pattern as string);
    } catch (error) {
      errors.push(`params.pattern is not a valid regular expression: ${(error as Error).message}`);
    }
  }
  if (params.prefixes !== undefined && !Array.isArray(params.prefixes)) {
    errors.push('params.prefixes must be a list of strings');
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asNamingParams(rule);
  return [
    {
      target: 'lint',
      ruleId: rule.id,
      content: {
        files: appliesToGlobs(params.appliesTo),
        forbid: 'name-not-matching',
        target: params.target ?? 'exports',
        ...(params.pattern === undefined ? {} : { pattern: params.pattern }),
        ...(params.prefixes === undefined ? {} : { prefixes: params.prefixes }),
        // The statement goes into the message, so the editor shows the rule's own sentence.
        message: `${rule.statement} — ${rule.remedy.summary}`,
        autofix: false,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  const what = evidence.namedThing === 'file' ? 'file' : 'export';
  return [
    `${what} '${String(evidence.name)}' does not follow the naming rule`,
    `  ${finding.file}`,
    `  expected: ${describeExpectation(asNamingParams(rule))}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  const what = evidence.namedThing === 'file' ? 'file' : 'export';
  return {
    statement: `${what} '${String(evidence.name)}' must ${describeExpectation(asNamingParams(rule))}`,
    remedy: { ...rule.remedy, autofix: false },
  };
}

export const namingContract: ContractType = {
  kind: 'naming',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

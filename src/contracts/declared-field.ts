/**
 * The `declared-field` kind — rules about what must be DECLARED at a call site.
 *
 * What this covers: "every endpoint declares a permission and an operation id". A global middleware
 * chain knows who the caller is; only the endpoint knows what is being asked, so the declaration
 * has to be at the call site — and a call site that forgot it is invisible to every other kind.
 *
 * Finding the call and reading its arguments is AST work, and it happens in the graph layer: this
 * file asks "where is `registerRoute` called, and what do its object arguments declare", and
 * decides from the answer. Before 0.3.2 it did the walk itself, which is why the kind silently
 * could not run against an ingested graph.
 *
 * What a caller must know: the check is that the field is PRESENT (and, optionally, one of a set
 * of allowed values). Whether the value is the right permission for that endpoint is a judgement
 * rule, not this one.
 */
import type { SyntaxFacts } from '../graph/syntax.js';
import { requestKey, type SyntaxRequest } from '../graph/syntaxRequest.js';
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { matchesAny } from '../util/glob.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type DeclaredFieldParams = {
  appliesTo: string | string[];
  /** The callee, e.g. `registerRoute` or `router.get`. */
  on: string;
  /** The property that must appear in one of the call's object-literal arguments. */
  field: string;
  /** When given, the value must also be one of these string literals. */
  allowed?: string[];
};

export function asDeclaredFieldParams(rule: Rule): DeclaredFieldParams {
  return rule.params as unknown as DeclaredFieldParams;
}

export function declaredFieldApplies(params: DeclaredFieldParams, relativePath: string): boolean {
  const globs = typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo;
  return matchesAny(globs, relativePath);
}

export type MissingDeclaration = {
  line: number;
  col: number;
  call: string;
  /** 'absent' when the field is missing entirely; 'not-allowed' when its value is out of range. */
  problem: 'absent' | 'not-allowed';
  found?: string;
};

/** The question this rule asks of the graph: where is this callee called? */
export function declaredFieldRequest(params: DeclaredFieldParams): SyntaxRequest {
  return { construct: 'declared-field-call', target: params.on };
}

/**
 * Call sites of `params.on` that do not declare `params.field`, or declare it out of range.
 *
 * A non-literal value is accepted: it may be a constant, and guessing would produce a false
 * positive on correct code — which is worse than missing one. That is why a collected field
 * carries `value` only when the property was written as a string literal.
 */
export function findMissingDeclarations(
  params: DeclaredFieldParams,
  facts: SyntaxFacts | undefined,
): MissingDeclaration[] {
  const occurrences = facts?.[requestKey(declaredFieldRequest(params))] ?? [];
  const found: MissingDeclaration[] = [];
  const call = `${params.on}(…)`;

  for (const occurrence of occurrences) {
    const declared = (occurrence.fields ?? []).find((field) => field.name === params.field);
    if (declared === undefined) {
      found.push({ line: occurrence.line, col: occurrence.col, call, problem: 'absent' });
      continue;
    }
    if (params.allowed === undefined || params.allowed.length === 0) continue;
    if (declared.value === undefined || params.allowed.includes(declared.value)) continue;
    found.push({
      line: occurrence.line,
      col: occurrence.col,
      call,
      problem: 'not-allowed',
      found: declared.value,
    });
  }

  return found;
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  const appliesTo = params.appliesTo;
  const globs = typeof appliesTo === 'string' ? [appliesTo] : appliesTo;
  if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === 'string')) {
    errors.push('params.appliesTo is required — a path glob, or a list of them');
  }
  if (typeof params.on !== 'string' || params.on.length === 0) {
    errors.push("params.on is required — the call being checked, e.g. 'registerRoute'");
  }
  if (typeof params.field !== 'string' || params.field.length === 0) {
    errors.push("params.field is required — the property that must be declared, e.g. 'permission'");
  }
  if (params.allowed !== undefined) {
    if (!Array.isArray(params.allowed) || !params.allowed.every((v) => typeof v === 'string')) {
      errors.push('params.allowed must be a list of strings when given');
    }
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asDeclaredFieldParams(rule);
  return [
    {
      target: 'test',
      ruleId: rule.id,
      content: {
        files: typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo,
        on: params.on,
        field: params.field,
        ...(params.allowed === undefined ? {} : { allowed: params.allowed }),
        message: `${rule.statement} — ${rule.remedy.summary}`,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  const params = asDeclaredFieldParams(rule);
  const detail =
    evidence.problem === 'absent'
      ? `declares no '${params.field}'`
      : `declares '${params.field}' as '${String(evidence.found)}', which is not allowed`;
  return [
    `${String(evidence.call)} ${detail}`,
    `  ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`,
    ...(params.allowed ? [`  allowed: ${params.allowed.join(', ')}`] : []),
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  const params = asDeclaredFieldParams(rule);
  return {
    statement:
      evidence.problem === 'absent'
        ? `${String(evidence.call)} must declare '${params.field}'`
        : `'${String(evidence.found)}' is not an allowed '${params.field}'`,
    remedy: { ...rule.remedy, ...(params.allowed ? { allowed: params.allowed } : {}) },
  };
}

export const declaredFieldContract: ContractType = {
  kind: 'declared-field',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

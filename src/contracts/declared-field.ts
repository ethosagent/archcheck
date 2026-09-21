/**
 * The `declared-field` kind — rules about what must be DECLARED at a call site.
 *
 * What this covers: "every endpoint declares a permission and an operation id". A global middleware
 * chain knows who the caller is; only the endpoint knows what is being asked, so the declaration
 * has to be at the call site — and a call site that forgot it is invisible to every other kind.
 *
 * This is AST work, not filesystem work. It means finding the call expression and reading its
 * arguments, which needs the program the graph reader already built.
 *
 * What a caller must know: the check is that the field is PRESENT (and, optionally, one of a set
 * of allowed values). Whether the value is the right permission for that endpoint is a judgement
 * rule, not this one.
 */
import ts from 'typescript';
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

function propertyNamed(object: ts.ObjectLiteralExpression, field: string) {
  return object.properties.find((property) => {
    const name = property.name;
    if (!name) return false;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text === field;
    return false;
  });
}

function literalValueOf(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  return ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined;
}

export function findMissingDeclarations(
  params: DeclaredFieldParams,
  source: ts.SourceFile | undefined,
): MissingDeclaration[] {
  if (source === undefined) return [];
  const found: MissingDeclaration[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === params.on) {
      const objects = node.arguments.filter(ts.isObjectLiteralExpression);
      const property = objects
        .map((object) => propertyNamed(object, params.field))
        .find((match) => match !== undefined);
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const call = `${params.on}(…)`;

      if (property === undefined) {
        found.push({ line: line + 1, col: character + 1, call, problem: 'absent' });
      } else if (params.allowed && params.allowed.length > 0) {
        const value = literalValueOf(property);
        // A non-literal value is accepted: it may be a constant, and guessing would produce a
        // false positive on correct code — which is worse than missing one.
        if (value !== undefined && !params.allowed.includes(value)) {
          found.push({
            line: line + 1,
            col: character + 1,
            call,
            problem: 'not-allowed',
            found: value,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
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

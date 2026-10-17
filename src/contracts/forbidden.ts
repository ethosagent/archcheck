/**
 * The `forbidden` kind — one specific edge is banned.
 *
 * What this covers that `layers` cannot: `layers` is an allow-list over whole layers, so the only
 * way to ban "checkout must not import the payments SDK directly" was to restructure every layer
 * around that one edge. This bans the edge and leaves the layers alone.
 *
 * It is also the first way to ban an EXTERNAL import, through `to.package`. A specifier is not a
 * path — `@aws-sdk/client-s3` has a slash belonging to the scope — so package patterns are decided
 * by `packageMatch.ts` rather than by the path matcher.
 *
 * What a caller must know: `from` and `to` are independent, and a side matches only when every key
 * it declares matches. A side declaring nothing is a config error rather than a wildcard, because
 * a rule that bans every edge is never what somebody meant to write.
 */
import { err, ok, type Result } from '../result.js';
import type { EdgeFilter, Fragment, RawFinding, Rule } from '../types.js';
import { globProblems } from '../util/glob.js';
import {
  type EdgeFacts,
  type ForbiddenSide,
  type ForbiddenTarget,
  sideMatches,
  targetMatches,
} from './forbiddenMatch.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

export type ForbiddenParams = {
  from: ForbiddenSide;
  to: ForbiddenTarget;
  /** Which edges this rule looks at. `'all'` by default. See `EdgeFilter`. */
  edges?: EdgeFilter;
};

export function asForbiddenParams(rule: Rule): ForbiddenParams {
  return rule.params as unknown as ForbiddenParams;
}

/** The whole decision, as a pure function of two edge ends. No AST, no I/O. */
export function forbiddenApplies(params: ForbiddenParams, from: EdgeFacts, to: EdgeFacts): boolean {
  return sideMatches(params.from, from) && targetMatches(params.to, to);
}

function asList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function sideProblems(side: unknown, field: string, declaredLayers: Set<string>): string[] {
  if (typeof side !== 'object' || side === null) {
    return [`params.${field} must be an object naming a layer, a glob, or a package`];
  }
  const problems: string[] = [];
  const keys = side as Record<string, unknown>;
  const names = ['layer', 'glob', 'package'].filter((key) => keys[key] !== undefined);
  if (names.length === 0) {
    problems.push(
      `params.${field} declares nothing — a side with no layer, glob or package would match ` +
        'every edge, which is never the rule somebody meant to write',
    );
  }
  // The most common manifest typo, and the one a glob cannot catch: a layer nobody declared.
  if (typeof keys.layer === 'string' && !declaredLayers.has(keys.layer)) {
    const known = [...declaredLayers].sort().join(', ');
    problems.push(
      `params.${field}.layer names an unknown layer '${keys.layer}' — declared layers are ` +
        `${known.length > 0 ? known : 'none'}`,
    );
  }
  for (const key of ['glob', 'except'] as const) {
    for (const pattern of asList(keys[key])) {
      for (const problem of globProblems(pattern)) {
        problems.push(`params.${field}.${key} pattern '${pattern}' ${problem}`);
      }
    }
  }
  return problems;
}

function validateParams(rule: Rule, ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  const declaredLayers = new Set(
    ctx.rules
      .filter((other) => other.kind === 'layers')
      .map((other) => (other.params as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === 'string'),
  );

  errors.push(...sideProblems(params.from, 'from', declaredLayers));
  errors.push(...sideProblems(params.to, 'to', declaredLayers));

  const to = params.to as Record<string, unknown> | null;
  if (to !== null && typeof to === 'object' && to.package !== undefined) {
    // A package ban reads an external edge and a path ban reads an internal one, so a `to` that
    // declares both can never match anything. Rejected rather than silently matching nothing.
    if (to.layer !== undefined || to.glob !== undefined) {
      errors.push(
        'params.to declares package alongside layer or glob — a package ban reads an external ' +
          'import and a layer or glob reads an internal one, so the pair matches nothing',
      );
    }
    if (typeof params.from === 'object' && params.from !== null) {
      const from = params.from as Record<string, unknown>;
      if (from.package !== undefined) {
        errors.push('params.from.package is meaningless — an import always starts in this repo');
      }
    }
  }

  const edges = params.edges;
  if (edges !== undefined && edges !== 'all' && edges !== 'production') {
    errors.push(`params.edges must be 'all' or 'production' (got ${JSON.stringify(edges)})`);
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function describeSide(side: ForbiddenSide | ForbiddenTarget): string {
  const parts: string[] = [];
  if (side.layer !== undefined) parts.push(`layer ${side.layer}`);
  if (side.glob !== undefined) parts.push(asList(side.glob).join(', '));
  const target = side as ForbiddenTarget;
  if (target.package !== undefined) parts.push(`package ${asList(target.package).join(', ')}`);
  return parts.length > 0 ? parts.join(' and ') : 'anything';
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asForbiddenParams(rule);
  const fragments: Fragment[] = [
    {
      target: 'graph',
      ruleId: rule.id,
      content: {
        forbid: 'edge',
        from: params.from,
        to: params.to,
        ...(params.edges === undefined ? {} : { edges: params.edges }),
        statement: rule.statement,
      },
    },
  ];

  // The lint sink can only express a path-shaped ban, so a package ban or a layer-only side
  // contributes nothing here rather than being approximated into a pattern that is not the rule.
  const files = asList(params.from.glob);
  const patterns =
    params.to.package === undefined ? asList(params.to.glob) : asList(params.to.package);
  if (files.length === 0 || patterns.length === 0) return fragments;

  fragments.push({
    target: 'lint',
    ruleId: rule.id,
    content: {
      files,
      forbid: 'import-path-matching',
      patterns: [...patterns].sort(),
      message: `${rule.statement} — ${rule.remedy.summary}`,
    },
  });
  return fragments;
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  const params = asForbiddenParams(rule);
  return [
    `${finding.file} may not import ${String(evidence.specifier ?? evidence.to ?? '')}`,
    `  banned: ${describeSide(params.from)} → ${describeSide(params.to)}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(finding: RawFinding, rule: Rule): Refinement {
  const evidence = finding.evidence as Record<string, unknown>;
  return {
    statement: `${finding.file} may not import ${String(evidence.specifier ?? evidence.to ?? '')}`,
    // Deliberately no `allowed` list: nothing was allow-listed, one edge was banned, and offering
    // a list would invite a reader to widen something that does not exist.
    remedy: rule.remedy,
  };
}

export const forbiddenContract: ContractType = {
  kind: 'forbidden',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

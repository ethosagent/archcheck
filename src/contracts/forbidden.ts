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
import { DEFAULT_DIMENSION, dimensionOf } from './dimensions.js';
import { dimensionProblems, dimensionsOfSide } from './forbiddenDimensions.js';
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

/** The layer names declared on each axis: `layer` by default, plus anything #5 added. */
type Axes = Map<string, Set<string>>;

function sideProblems(side: unknown, field: string, axes: Axes): string[] {
  if (typeof side !== 'object' || side === null) {
    return [`params.${field} must be an object naming a layer, a glob, or a package`];
  }
  const problems: string[] = [];
  const keys = side as Record<string, unknown>;
  const dimensions = dimensionsOfSide(keys);
  const named = ['glob', 'package'].filter((key) => keys[key] !== undefined);
  if (named.length === 0 && Object.keys(dimensions).length === 0) {
    problems.push(
      `params.${field} declares nothing — a side with no layer, glob or package would match ` +
        'every edge, which is never the rule somebody meant to write',
    );
  }
  // An axis nobody declared. Caught here rather than at run time, where it would ban no edge and
  // look exactly like a rule that is satisfied.
  for (const problem of dimensionProblems(keys, [...axes.keys()])) {
    problems.push(`params.${field} ${problem}`);
  }
  // The most common manifest typo, and the one a glob cannot catch: a layer nobody declared.
  for (const [dimension, value] of Object.entries(dimensions)) {
    const layers = axes.get(dimension);
    if (layers === undefined || typeof value !== 'string' || layers.has(value)) continue;
    const known = [...layers].sort().join(', ');
    problems.push(
      `params.${field}.${dimension} names an unknown layer '${value}' on dimension ` +
        `'${dimension}' — layers there are ${known.length > 0 ? known : 'none'}`,
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

  // The default axis is always a known dimension, even in a manifest that declares no layers at
  // all: `{ layer: ... }` must report an unknown LAYER, which is the useful message, rather than
  // an unknown dimension, which would be a lie.
  const axes: Axes = new Map([[DEFAULT_DIMENSION, new Set<string>()]]);
  for (const other of ctx.rules) {
    if (other.kind !== 'layers') continue;
    const name = (other.params as Record<string, unknown>).name;
    const dimension = dimensionOf(other);
    const already = axes.get(dimension) ?? new Set<string>();
    if (typeof name === 'string') already.add(name);
    axes.set(dimension, already);
  }

  errors.push(...sideProblems(params.from, 'from', axes));
  errors.push(...sideProblems(params.to, 'to', axes));

  const to = params.to as Record<string, unknown> | null;
  if (to !== null && typeof to === 'object' && to.package !== undefined) {
    // A package ban reads an external edge and a path ban reads an internal one, so a `to` that
    // declares both can never match anything. Rejected rather than silently matching nothing.
    if (to.glob !== undefined || Object.keys(dimensionsOfSide(to)).length > 0) {
      errors.push(
        'params.to declares package alongside a layer, a dimension or a glob — a package ban ' +
          'reads an external import and the others read an internal one, so the pair matches ' +
          'nothing',
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
  for (const [dimension, value] of Object.entries(dimensionsOfSide(side))) {
    parts.push(`${dimension} ${String(value)}`);
  }
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

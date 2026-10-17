/**
 * The `banned-syntax` kind. Constructs that are wrong wherever they appear in a given scope.
 *
 * What rule this enforces, and why the selector is a CLOSED SET rather than a selector language:
 * the six rule families this kind exists for are
 *   no clock in a pure rule, no computed dynamic import, no console outside an entry point,
 *   no inline suppression comment, no branching on a literal name, no empty catch.
 * Each is one named construct. A CSS-ish selector string would have to be parsed, would be
 * half-implemented for years, and would let a manifest declare a selector that silently matches
 * nothing — which looks exactly like compliance. A closed enum cannot do that: an unknown
 * construct fails validation and exits 2.
 *
 * The inline-suppression ban is self-referential and deliberate. Exceptions live in the manifest
 * with an owner and an expiry (plan 15); making the inline escape hatch itself a violation is what
 * stops the manifest being bypassed.
 *
 * What a caller must know: this file WALKS NOTHING. It states the question as a `SyntaxRequest`,
 * and the graph answers it once per file and caches the answer. Before 0.3.2 the walk lived here,
 * which meant the kind could not run against an ingested graph, paid for its walk on every run,
 * and put the compiler API in the layer that is meant to hold decisions only. `remedy.autofix`
 * stays false.
 */
import type { SyntaxFacts } from '../graph/syntax.js';
import { requestKey, type SyntaxRequest } from '../graph/syntaxRequest.js';
import type { Edge } from '../graph/types.js';
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { globProblems, matchesAny } from '../util/glob.js';
import { matchesPattern, patternProblems } from '../util/literalPattern.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

/** The closed set. Adding one is a deliberate change with a fixture, not a config value. */
export const BANNED_CONSTRUCTS = [
  'member-access',
  'new-expression',
  'computed-dynamic-import',
  'suppression-comment',
  'string-literal-comparison',
  'empty-catch',
  'call',
  'reference',
  'string-literal',
  'module-mutable-state',
] as const;

export type BannedConstruct = (typeof BANNED_CONSTRUCTS)[number];

/** Constructs that name what they ban, and are meaningless without it. */
const NEEDS_TARGET = new Set<BannedConstruct>([
  'member-access',
  'new-expression',
  'call',
  'reference',
]);

/** Constructs that ban a SHAPE, so a target would name something they never read. */
const REFUSES_TARGET = new Set<BannedConstruct>(['module-mutable-state', 'string-literal']);

export type BannedSyntaxParams = {
  appliesTo: string | string[];
  selector: BannedConstruct;
  /** The dotted name to ban, e.g. `Date.now` or `console`. Required by some constructs. */
  target?: string;
  /** The regular expression a `string-literal` ban matches. Required by that selector alone. */
  pattern?: string;
  /**
   * The one place the banned thing is allowed: the config module that may read `process.env`, the
   * API client that may call `fetch`. A carve-out beside the rule beats a rule nobody can adopt.
   */
  except?: string | string[];
};

export function asBannedSyntaxParams(rule: Rule): BannedSyntaxParams {
  return rule.params as unknown as BannedSyntaxParams;
}

export function bannedSyntaxApplies(params: BannedSyntaxParams, relativePath: string): boolean {
  const globs = typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo;
  if (!matchesAny(globs, relativePath)) return false;
  if (params.except === undefined) return true;
  const carve = typeof params.except === 'string' ? [params.except] : params.except;
  return !matchesAny(carve, relativePath);
}

export type BannedOccurrence = { line: number; col: number; snippet: string };

/**
 * The question this rule asks of the graph, or undefined when it asks nothing.
 *
 * `computed-dynamic-import` is the one that asks nothing: the graph reader already reports a
 * computed specifier as an edge, because a dynamic import that resolves to nothing is exactly how
 * a layer violation hides, and re-detecting it would be a second implementation of the one thing
 * that is hard to get right.
 *
 * A `pattern` is deliberately NOT part of the request. Which strings matter is this rule's
 * decision, applied below; keeping it out means editing the pattern does not invalidate a cache
 * entry, and two rules with different patterns share one collection pass.
 */
export function bannedSyntaxRequest(params: BannedSyntaxParams): SyntaxRequest | undefined {
  if (params.selector === 'computed-dynamic-import') return undefined;
  if (!NEEDS_TARGET.has(params.selector)) return { construct: params.selector };
  return { construct: params.selector, target: params.target ?? '' };
}

/**
 * Occurrences of the banned construct in one file, read from the facts the graph collected.
 *
 * A missing key is not an empty one. `facts` without this rule's key means the run never asked the
 * question — a different thing from asking and finding nothing — so the caller gets nothing rather
 * than a clean verdict it has not earned.
 */
export function findBannedOccurrences(
  params: BannedSyntaxParams,
  facts: SyntaxFacts | undefined,
  computedImports: readonly Edge[],
): BannedOccurrence[] {
  if (params.selector === 'computed-dynamic-import') {
    return computedImports.map((edge) => ({
      line: edge.line,
      col: edge.col,
      snippet: `import(${edge.specifier})`,
    }));
  }
  const request = bannedSyntaxRequest(params);
  if (request === undefined) return [];
  const found = facts?.[requestKey(request)] ?? [];
  if (params.selector !== 'string-literal') return found;
  const pattern = params.pattern;
  if (pattern === undefined) return [];
  return found.filter((occurrence) => matchesPattern(pattern, occurrence.snippet));
}

function validateParams(rule: Rule, _ctx: ValidateCtx): Result<void> {
  const params = rule.params as Record<string, unknown>;
  const errors: string[] = [];

  const named = params.selector as BannedConstruct;
  if (REFUSES_TARGET.has(named) && params.target !== undefined) {
    errors.push(
      `params.target is meaningless for selector '${named}' — it bans a shape, not a name, ` +
        'so a target would name something the rule never reads',
    );
  }
  if (named === 'string-literal') {
    for (const problem of patternProblems(params.pattern)) {
      errors.push(`params.pattern ${problem}`);
    }
  } else if (params.pattern !== undefined) {
    errors.push(`params.pattern is only read by selector 'string-literal'`);
  }
  if (params.except !== undefined) {
    const carve = typeof params.except === 'string' ? [params.except] : params.except;
    if (!Array.isArray(carve) || !carve.every((entry) => typeof entry === 'string')) {
      errors.push('params.except must be a path glob, or a list of them');
    } else {
      for (const pattern of carve) {
        for (const problem of globProblems(pattern)) {
          errors.push(`params.except pattern '${pattern}' ${problem}`);
        }
      }
    }
  }

  const appliesTo = params.appliesTo;
  const globs = typeof appliesTo === 'string' ? [appliesTo] : appliesTo;
  if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === 'string')) {
    errors.push('params.appliesTo is required — a path glob, or a list of them');
  }

  const selector = params.selector as BannedConstruct;
  if (!BANNED_CONSTRUCTS.includes(selector)) {
    errors.push(
      `params.selector must be one of ${BANNED_CONSTRUCTS.join(', ')} ` +
        `(got ${JSON.stringify(params.selector)}) — the set is closed so a rule cannot silently match nothing`,
    );
  } else if (
    NEEDS_TARGET.has(selector) &&
    (typeof params.target !== 'string' || params.target.length === 0)
  ) {
    errors.push(`params.target is required for selector '${selector}' — name what is banned`);
  } else if (!NEEDS_TARGET.has(selector) && params.target !== undefined) {
    errors.push(`params.target means nothing for selector '${selector}' — remove it`);
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
}

function emitFragments(rule: Rule, _ctx: EmitCtx): Fragment[] {
  const params = asBannedSyntaxParams(rule);
  return [
    {
      target: 'lint',
      ruleId: rule.id,
      content: {
        files: typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo,
        forbid: params.selector,
        ...(params.target === undefined ? {} : { target: params.target }),
        message: `${rule.statement} — ${rule.remedy.summary}`,
        autofix: false,
      },
    },
  ];
}

function explainFinding(finding: RawFinding, rule: Rule, _ctx: ExplainCtx): string {
  const evidence = finding.evidence as Record<string, unknown>;
  return [
    rule.statement,
    `  ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`,
    `  found: ${String(evidence.snippet)}`,
    `  → ${rule.remedy.summary}`,
  ].join('\n');
}

function refineFinding(_finding: RawFinding, rule: Rule): Refinement {
  return { remedy: { ...rule.remedy, autofix: false } };
}

export const bannedSyntaxContract: ContractType = {
  kind: 'banned-syntax',
  validate: validateParams,
  emit: emitFragments,
  explain: explainFinding,
  refine: refineFinding,
};

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
 * What a caller must know: these are evaluated over OUR OWN AST. We already hold the program from
 * the graph reader, so a second parse would be waste. `remedy.autofix` stays false.
 */
import ts from 'typescript';
import type { Edge } from '../graph/types.js';
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { matchesAny } from '../util/glob.js';
import type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

/** The closed set. Adding one is a deliberate change with a fixture, not a config value. */
export const BANNED_CONSTRUCTS = [
  'member-access',
  'new-expression',
  'computed-dynamic-import',
  'suppression-comment',
  'string-literal-comparison',
  'empty-catch',
] as const;

export type BannedConstruct = (typeof BANNED_CONSTRUCTS)[number];

/** Constructs that name what they ban, and are meaningless without it. */
const NEEDS_TARGET = new Set<BannedConstruct>(['member-access', 'new-expression']);

export type BannedSyntaxParams = {
  appliesTo: string | string[];
  selector: BannedConstruct;
  /** The dotted name to ban, e.g. `Date.now` or `console`. Required by some constructs. */
  target?: string;
};

export function asBannedSyntaxParams(rule: Rule): BannedSyntaxParams {
  return rule.params as unknown as BannedSyntaxParams;
}

export function bannedSyntaxApplies(params: BannedSyntaxParams, relativePath: string): boolean {
  const globs = typeof params.appliesTo === 'string' ? [params.appliesTo] : params.appliesTo;
  return matchesAny(globs, relativePath);
}

export type BannedOccurrence = { line: number; col: number; snippet: string };

function positionOf(source: ts.SourceFile, node: ts.Node): { line: number; col: number } {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, col: character + 1 };
}

/** `console` matches `console.log`; `Date.now` matches only `Date.now`. */
function dottedMatches(target: string, text: string): boolean {
  return text === target || text.startsWith(`${target}.`);
}

const SUPPRESSION = /(eslint-disable|biome-ignore|@ts-ignore|@ts-expect-error|archcheck-ignore)/;

function scanAst(
  params: BannedSyntaxParams,
  source: ts.SourceFile,
  found: BannedOccurrence[],
): void {
  const record = (node: ts.Node, snippet: string) => {
    found.push({ ...positionOf(source, node), snippet });
  };

  const visit = (node: ts.Node): void => {
    switch (params.selector) {
      case 'member-access':
        if (
          ts.isPropertyAccessExpression(node) &&
          dottedMatches(params.target ?? '', node.getText(source))
        ) {
          record(node, node.getText(source));
        } else if (
          ts.isIdentifier(node) &&
          node.text === params.target &&
          !ts.isPropertyAccessExpression(node.parent)
        ) {
          record(node, node.text);
        }
        break;
      case 'new-expression':
        if (ts.isNewExpression(node) && node.expression.getText(source) === params.target) {
          record(node, `new ${params.target}()`);
        }
        break;
      case 'string-literal-comparison':
        if (
          ts.isBinaryExpression(node) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
          (ts.isStringLiteralLike(node.left) || ts.isStringLiteralLike(node.right))
        ) {
          record(node, node.getText(source).slice(0, 60));
        }
        break;
      case 'empty-catch':
        // A block holding only a comment is an EXPLAINED silence, which the rule allows. Counting
        // statements alone flags it, and found two false positives in archcheck's own source the
        // first time it checked itself.
        if (
          ts.isCatchClause(node) &&
          node.block.statements.length === 0 &&
          node.block.getText(source).replace(/[{}\s]/g, '').length === 0
        ) {
          record(node, 'catch {}');
        }
        break;
      case 'computed-dynamic-import':
      case 'suppression-comment':
        // Handled outside the AST walk: one from the graph, one from the comment scanner.
        break;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
}

/**
 * Comment trivia only, via the compiler's own scanner.
 *
 * Reading raw lines instead looks equivalent and is not: it matches the words wherever they appear,
 * including inside the very pattern above. That false positive is how this function was found — by
 * archcheck flagging this file on its first self-host run.
 */
function scanComments(source: ts.SourceFile, found: BannedOccurrence[]): void {
  const text = source.getFullText();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    const comment = scanner.getTokenText();
    if (!SUPPRESSION.test(comment)) continue;
    const { line, character } = source.getLineAndCharacterOfPosition(scanner.getTokenStart());
    found.push({ line: line + 1, col: character + 1, snippet: comment.trim().slice(0, 60) });
  }
}

/**
 * Occurrences of the banned construct in one file.
 *
 * `computedImports` comes from the graph reader, which already detects a computed dynamic import —
 * re-detecting it here would be a second implementation of the one thing that is hard to get right.
 */
export function findBannedOccurrences(
  params: BannedSyntaxParams,
  source: ts.SourceFile | undefined,
  computedImports: readonly Edge[],
): BannedOccurrence[] {
  const found: BannedOccurrence[] = [];
  if (params.selector === 'computed-dynamic-import') {
    for (const edge of computedImports) {
      found.push({ line: edge.line, col: edge.col, snippet: `import(${edge.specifier})` });
    }
    return found;
  }
  if (source === undefined) return found;
  if (params.selector === 'suppression-comment') {
    scanComments(source, found);
    return found;
  }
  scanAst(params, source, found);
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

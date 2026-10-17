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
import { resolveQualified } from '../graph/symbols.js';
import type { Edge } from '../graph/types.js';
import { err, ok, type Result } from '../result.js';
import type { Fragment, RawFinding, Rule } from '../types.js';
import { globProblems, matchesAny } from '../util/glob.js';
import { matchesPattern, patternProblems } from '../util/literalPattern.js';
import { isQualified, qualifiedMatches } from '../util/qualifiedTarget.js';
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

function positionOf(source: ts.SourceFile, node: ts.Node): { line: number; col: number } {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, col: character + 1 };
}

/** `console` matches `console.log`; `Date.now` matches only `Date.now`. */
function dottedMatches(target: string, text: string): boolean {
  return text === target || text.startsWith(`${target}.`);
}

const SUPPRESSION = /(eslint-disable|biome-ignore|@ts-ignore|@ts-expect-error|archcheck-ignore)/;

/** `import 'x'` and `export ... from 'x'`: a specifier is not a hard-coded value. */
function isImportSpecifierText(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  return ts.isImportTypeNode(parent) || ts.isExternalModuleReference(parent);
}

/** A string inside a literal type says what a value may BE, not what it is. */
function isTypePosition(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isLiteralTypeNode(at) || ts.isTypeAliasDeclaration(at)) return true;
    if (ts.isStatement(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

function scanAst(
  params: BannedSyntaxParams,
  source: ts.SourceFile,
  found: BannedOccurrence[],
  checker?: ts.TypeChecker,
): void {
  const target = params.target ?? '';
  // A qualified target is decided by what the name REFERS to, which needs a checker. A dotted
  // target keeps the text comparison it always had, so existing manifests are unaffected — and a
  // qualified target without a checker finds nothing rather than guessing from the text, because
  // the whole point of writing it qualified was to stop trusting the text.
  const bySymbol = isQualified(target) && checker !== undefined;
  // A declaration is not a use. The import that brings `exec` in, and the binding that pulls
  // `log` out of `console`, both REFER to the banned symbol — but `banned-syntax` is about code
  // that uses a construct, and banning the import itself is what `forbidden` and `layers` are
  // for. The text path never matched an import line either.
  //
  // The relationship is DIRECT, not ancestral: a first attempt walked the ancestors and matched
  // `isVariableDeclaration`, which silenced every call site too, because `const one = () =>
  // run(...)` puts the call inside a variable declaration.
  const isDeclarationSite = (node: ts.Node): boolean => {
    const parent = node.parent;
    if (parent === undefined) return false;
    if (ts.isImportSpecifier(parent)) return true;
    if (ts.isNamespaceImport(parent) || ts.isImportClause(parent)) return true;
    if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node;
    return false;
  };
  const symbolHit = (node: ts.Node): string | undefined => {
    if (!bySymbol || checker === undefined) return undefined;
    if (isDeclarationSite(node)) return undefined;
    const resolved = resolveQualified(node, checker);
    if (resolved === undefined || !qualifiedMatches(target, resolved)) return undefined;
    return resolved;
  };
  const record = (node: ts.Node, snippet: string) => {
    found.push({ ...positionOf(source, node), snippet });
  };

  const visit = (node: ts.Node): void => {
    switch (params.selector) {
      case 'member-access': {
        if (bySymbol) {
          // The outermost node of a chain again, for the same reason: `console.log.call` would
          // otherwise be counted at two depths. An identifier whose parent is a property access
          // is skipped, because the parent carries the whole path.
          const skip =
            ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node;
          const resolved = skip ? undefined : symbolHit(node);
          if (resolved !== undefined) record(node, resolved);
          break;
        }
        // Only the OUTERMOST matching node of a chain: `process.env.A` contains `process.env`,
        // and both match, so without the parent check one access counted twice (0.2.0). Pinned by
        // 'one access chain is one occurrence' in banned-syntax.test.ts.
        if (
          ts.isPropertyAccessExpression(node) &&
          dottedMatches(params.target ?? '', node.getText(source)) &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node &&
            dottedMatches(params.target ?? '', node.parent.getText(source))
          )
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
      }
      case 'new-expression': {
        if (!ts.isNewExpression(node)) break;
        if (bySymbol) {
          const resolved = symbolHit(node.expression);
          if (resolved !== undefined) record(node, `new ${resolved}()`);
          break;
        }
        if (node.expression.getText(source) === params.target) {
          record(node, `new ${params.target}()`);
        }
        break;
      }
      // A call is defined by what the callee RESOLVES to, which is the whole reason #7 came
      // first: before it, `fetch` aliased to anything evaded the ban.
      case 'call': {
        if (!ts.isCallExpression(node)) break;
        const resolved = symbolHit(node.expression);
        if (resolved !== undefined) record(node, `${resolved}()`);
        break;
      }

      // Broader than `call`: any READ of the symbol, so `process.env` passed as an argument is
      // caught as well as `process.env.KEY` being read. The outermost node of a chain only.
      case 'reference': {
        if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) break;
        const resolved = symbolHit(node);
        if (resolved === undefined) break;
        // The outermost MATCHING node, not the outermost node. A ban on `process.env` has to fire
        // on `process.env.MODE`, where the whole chain resolves to `...env.MODE` and so does not
        // match — suppressing the inner node for merely having a parent would find nothing at
        // all. It is suppressed only when the parent matches too, which is the real double count.
        const parent = node.parent;
        const covered =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          symbolHit(parent) !== undefined;
        if (covered) break;
        record(node, resolved);
        break;
      }

      // A string the reader can act on. A specifier in `import 'x'` and a string inside a literal
      // type are neither hard-coded values nor things a remedy can move, and reporting them would
      // make this selector unusable in a real repository.
      case 'string-literal': {
        if (!ts.isStringLiteralLike(node)) break;
        if (params.pattern === undefined) break;
        if (isImportSpecifierText(node) || isTypePosition(node)) break;
        if (!matchesPattern(params.pattern, node.text)) break;
        record(node, node.text);
        break;
      }

      // Top-level `let` or `var`, and an exported binding that is not const. It bans a SHAPE, so
      // it reads no target: module state is hard to test and hard to swap whatever it is called.
      case 'module-mutable-state': {
        if (!ts.isVariableStatement(node)) break;
        if (!ts.isSourceFile(node.parent)) break;
        const flags = node.declarationList.flags;
        if ((flags & ts.NodeFlags.Const) !== 0) break;
        const keyword = (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
        const first = node.declarationList.declarations[0];
        const name = first === undefined ? '' : first.name.getText(source);
        record(node, `${keyword} ${name}`);
        break;
      }

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
 * Comment trivia only, read from the parsed AST rather than a hand-driven scanner.
 *
 * Reading raw lines instead looks equivalent and is not: it matches the words wherever they appear,
 * including inside the very pattern above. That false positive is how this function was found — by
 * archcheck flagging this file on its first self-host run.
 *
 * A bare `ts.createScanner` is not enough either. Whether `}` resumes a template and whether `/`
 * opens a regex depends on the grammar, which only the parser knows; a scanner driven without it
 * mis-tokenized everything after the first `${...}` substitution, and 0.2.0 missed every later
 * comment. So walk every TOKEN of the tree the parser already built: every comment is trivia
 * in front of exactly one token (the last ones in front of the end-of-file token), so reading each
 * token's comment ranges finds all of them, once each. Pinned by the template, nested-template and
 * regex cases in banned-syntax.test.ts.
 */
function scanComments(source: ts.SourceFile, found: BannedOccurrence[]): void {
  const text = source.getFullText();
  const seen = new Set<number>();
  const visit = (node: ts.Node): void => {
    // A JSDoc node's range lies INSIDE a comment, and JSX text is text, not trivia. Neither has
    // leading comments of its own; the JSDoc comment itself is the next token's leading trivia.
    if (ts.isJSDoc(node) || node.kind === ts.SyntaxKind.JsxText) return;
    const children = node.getChildren(source);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    // The compiler splits one token's trivia in two: comments on the line the previous token
    // ended on are "trailing", the rest "leading". Both halves, or a suppression written at the
    // end of a code line goes unseen. At position 0 the two overlap, hence `seen`.
    const ranges = [
      ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
    ];
    for (const range of ranges) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const comment = text.slice(range.pos, range.end);
      if (!SUPPRESSION.test(comment)) continue;
      const { line, character } = source.getLineAndCharacterOfPosition(range.pos);
      found.push({ line: line + 1, col: character + 1, snippet: comment.trim().slice(0, 60) });
    }
  };
  visit(source);
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
  checker?: ts.TypeChecker,
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
  scanAst(params, source, found, checker);
  return found;
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

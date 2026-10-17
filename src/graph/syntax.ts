/**
 * Collecting syntax facts from one SourceFile.
 *
 * What rule this enforces: the graph reports facts and a contract decides. Until 0.3.1 the
 * `banned-syntax` and `declared-field` kinds walked the AST themselves, from inside the contract
 * layer. That one difference from the other six kinds caused three problems at once — the AST
 * rules could not run against an ingested graph, their work was never cached, and every new
 * selector put another `typescript` import into the layer that is meant to hold decisions only.
 *
 * What a caller must know: collection is REQUEST-DRIVEN, not exhaustive. Recording every
 * identifier and every string literal in a repository, each resolved through the checker, would be
 * slower than the walk it replaces and would write a facts cache many times larger. A request set
 * derived from the manifest is bounded by the rules instead: archcheck's own manifest asks three
 * questions, so one traversal here replaces three.
 *
 * A fact says WHERE a construct is and WHAT it denotes. It never says whether that is allowed —
 * the file's scope, the rule's severity and a `string-literal` pattern are all decided by the
 * contract, which is why none of them appear in a request and none of them invalidate the cache.
 */
import ts from 'typescript';
import { isQualified, qualifiedMatches } from '../util/qualifiedTarget.js';
import { resolveQualified } from './symbols.js';
import {
  dedupeRequests,
  requestKey,
  type SyntaxConstruct,
  type SyntaxRequest,
} from './syntaxRequest.js';

/**
 * One place a construct was found. `snippet` is what the construct denotes — the resolved symbol
 * for a name, the source text for a shape — and it is what makes two occurrences in one file
 * distinguishable, which the identity hash needs.
 */
export type SyntaxOccurrence = {
  line: number;
  col: number;
  snippet: string;
  /**
   * The properties the call's object-literal arguments declare, in source order. Present for
   * `declared-field-call` alone. `value` is absent unless the property is a string literal: a
   * computed value may be a constant, and guessing is how a check gets a false positive on
   * correct code.
   */
  fields?: { name: string; value?: string }[];
};

/** Keyed by `requestKey`, so a fact finds its request again after a cache round trip. */
export type SyntaxFacts = Record<string, SyntaxOccurrence[]>;

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

/**
 * A declaration is not a use. The import that brings `exec` in, and the binding that pulls `log`
 * out of `console`, both REFER to the banned symbol — but these selectors are about code that USES
 * a construct, and banning the import itself is what `forbidden` and `layers` are for.
 *
 * The relationship is DIRECT, not ancestral: a first attempt walked the ancestors and matched
 * `isVariableDeclaration`, which silenced every call site too, because `const one = () =>
 * run(...)` puts the call inside a variable declaration.
 */
function isDeclarationSite(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isImportSpecifier(parent)) return true;
  if (ts.isNamespaceImport(parent) || ts.isImportClause(parent)) return true;
  if (ts.isBindingElement(parent)) return parent.name === node || parent.propertyName === node;
  return false;
}

function fieldsOf(node: ts.CallExpression): { name: string; value?: string }[] {
  const fields: { name: string; value?: string }[] = [];
  for (const argument of node.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.properties) {
      const name = property.name;
      if (!name) continue;
      if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name)) continue;
      const literal =
        ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
          ? property.initializer.text
          : undefined;
      fields.push({ name: name.text, ...(literal === undefined ? {} : { value: literal }) });
    }
  }
  return fields;
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
 * regex cases in src/graph/syntax.test.ts.
 */
function scanComments(source: ts.SourceFile, found: SyntaxOccurrence[]): void {
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

type Collector = (node: ts.Node, target: string, out: SyntaxOccurrence[]) => void;

/**
 * One collector per construct, so adding a selector adds a row rather than a branch.
 *
 * `symbolHit` is the whole reason the type checker is here: a name is decided by what it REFERS
 * to, not by how it is spelled, so `fetch` aliased to anything is still `fetch`. A dotted target
 * keeps the text comparison it always had, which is why existing manifests are unaffected; a
 * qualified target with no checker available finds nothing rather than guessing from the text,
 * because the point of writing it qualified was to stop trusting the text.
 */
function collectorsFor(
  source: ts.SourceFile,
  symbolHit: (node: ts.Node, target: string) => string | undefined,
  bySymbol: (target: string) => boolean,
): Record<SyntaxConstruct, Collector> {
  const record = (node: ts.Node, snippet: string, out: SyntaxOccurrence[]) => {
    out.push({ ...positionOf(source, node), snippet });
  };

  return {
    'member-access': (node, target, out) => {
      if (bySymbol(target)) {
        // The outermost node of a chain again, for the same reason: `console.log.call` would
        // otherwise be counted at two depths. An identifier whose parent is a property access
        // is skipped, because the parent carries the whole path.
        if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) return;
        const resolved = symbolHit(node, target);
        if (resolved !== undefined) record(node, resolved, out);
        return;
      }
      // Only the OUTERMOST matching node of a chain: `process.env.A` contains `process.env`,
      // and both match, so without the parent check one access counted twice (0.2.0).
      if (ts.isPropertyAccessExpression(node)) {
        if (!dottedMatches(target, node.getText(source))) return;
        const parent = node.parent;
        const covered =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          dottedMatches(target, parent.getText(source));
        if (!covered) record(node, node.getText(source), out);
        return;
      }
      if (ts.isIdentifier(node) && node.text === target) {
        if (!ts.isPropertyAccessExpression(node.parent)) record(node, node.text, out);
      }
    },

    'new-expression': (node, target, out) => {
      if (!ts.isNewExpression(node)) return;
      if (bySymbol(target)) {
        const resolved = symbolHit(node.expression, target);
        if (resolved !== undefined) record(node, `new ${resolved}()`, out);
        return;
      }
      if (node.expression.getText(source) === target) record(node, `new ${target}()`, out);
    },

    // A call is defined by what the callee RESOLVES to, which is the whole reason #7 came first:
    // before it, `fetch` aliased to anything evaded the ban.
    call: (node, target, out) => {
      if (!ts.isCallExpression(node)) return;
      const resolved = symbolHit(node.expression, target);
      if (resolved !== undefined) record(node, `${resolved}()`, out);
    },

    // Broader than `call`: any READ of the symbol, so `process.env` passed as an argument is
    // caught as well as `process.env.KEY` being read.
    reference: (node, target, out) => {
      if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return;
      const resolved = symbolHit(node, target);
      if (resolved === undefined) return;
      // The outermost MATCHING node, not the outermost node. A ban on `process.env` has to fire
      // on `process.env.MODE`, where the whole chain resolves to `...env.MODE` and so does not
      // match — suppressing the inner node for merely having a parent would find nothing at all.
      const parent = node.parent;
      const covered =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        symbolHit(parent, target) !== undefined;
      if (!covered) record(node, resolved, out);
    },

    // A string the reader can act on. A specifier in `import 'x'` and a string inside a literal
    // type are neither hard-coded values nor things a remedy can move, and reporting them would
    // make this selector unusable in a real repository. Which strings MATTER is the contract's
    // decision, so the pattern is applied there and never narrows what is collected here.
    'string-literal': (node, _target, out) => {
      if (!ts.isStringLiteralLike(node)) return;
      if (isImportSpecifierText(node) || isTypePosition(node)) return;
      record(node, node.text, out);
    },

    'string-literal-comparison': (node, _target, out) => {
      if (!ts.isBinaryExpression(node)) return;
      const operator = node.operatorToken.kind;
      const isEquality =
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      if (!isEquality) return;
      if (!ts.isStringLiteralLike(node.left) && !ts.isStringLiteralLike(node.right)) return;
      record(node, node.getText(source).slice(0, 60), out);
    },

    'empty-catch': (node, _target, out) => {
      if (!ts.isCatchClause(node)) return;
      // A block holding only a comment is an EXPLAINED silence, which the rule allows. Counting
      // statements alone flags it, and found two false positives in archcheck's own source the
      // first time it checked itself.
      if (node.block.statements.length > 0) return;
      if (node.block.getText(source).replace(/[{}\s]/g, '').length > 0) return;
      record(node, 'catch {}', out);
    },

    // Top-level `let` or `var`. It bans a SHAPE, so it reads no target: module state is hard to
    // test and hard to swap whatever it is called.
    'module-mutable-state': (node, _target, out) => {
      if (!ts.isVariableStatement(node)) return;
      if (!ts.isSourceFile(node.parent)) return;
      const flags = node.declarationList.flags;
      if ((flags & ts.NodeFlags.Const) !== 0) return;
      const keyword = (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
      const first = node.declarationList.declarations[0];
      const name = first === undefined ? '' : first.name.getText(source);
      record(node, `${keyword} ${name}`, out);
    },

    // The callee is matched by TEXT, which is what `declared-field` has always done: the rule
    // names a call the way it is written at the call site, `router.get` and not a symbol.
    'declared-field-call': (node, target, out) => {
      if (!ts.isCallExpression(node)) return;
      if (node.expression.getText(source) !== target) return;
      out.push({ ...positionOf(source, node), snippet: target, fields: fieldsOf(node) });
    },

    // Read from the comment trivia, not from the node walk.
    'suppression-comment': () => undefined,
  };
}

/**
 * Answer every request against one file.
 *
 * Every requested key is present in the result, with an empty list when nothing was found. That
 * distinction matters: "no occurrences" and "never asked" look the same to a caller that has to
 * reach for a default, and a rule reading a key nobody collected would report a clean file.
 */
export function collectSyntax(
  source: ts.SourceFile,
  checker: ts.TypeChecker | undefined,
  requests: readonly SyntaxRequest[],
): SyntaxFacts {
  const facts: SyntaxFacts = {};
  const wanted: { request: SyntaxRequest; out: SyntaxOccurrence[] }[] = [];
  for (const request of dedupeRequests(requests)) {
    const out: SyntaxOccurrence[] = [];
    facts[requestKey(request)] = out;
    wanted.push({ request, out });
  }
  if (wanted.length === 0) return facts;

  const bySymbol = (target: string) => isQualified(target) && checker !== undefined;
  const symbolHit = (node: ts.Node, target: string): string | undefined => {
    if (!bySymbol(target) || checker === undefined) return undefined;
    if (isDeclarationSite(node)) return undefined;
    const resolved = resolveQualified(node, checker);
    if (resolved === undefined || !qualifiedMatches(target, resolved)) return undefined;
    return resolved;
  };
  const collectors = collectorsFor(source, symbolHit, bySymbol);

  for (const { request, out } of wanted) {
    if (request.construct === 'suppression-comment') scanComments(source, out);
  }

  const walked = wanted.filter(({ request }) => request.construct !== 'suppression-comment');
  if (walked.length > 0) {
    const visit = (node: ts.Node): void => {
      for (const { request, out } of walked) {
        collectors[request.construct](node, request.target ?? '', out);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }

  return facts;
}

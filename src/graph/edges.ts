/**
 * Extracting edges, implemented-port names and exports from one SourceFile.
 *
 * What rule this enforces: the graph must be COMPLETE. Every way one module can reach another is
 * listed here — static import, re-export, `import =`, `require()`, and `import()` in both its
 * literal and its computed form. A form missing from this walk is a layer violation that hides
 * (LLD §1.3), so adding a form to the language means adding it here.
 */
import ts from 'typescript';
import type { DynamicKind, Edge, FileFacts } from './types.js';

function positionOf(source: ts.SourceFile, node: ts.Node): { line: number; col: number } {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: line + 1, col: character + 1 };
}

export type ResolveSpecifier = (
  specifier: string,
  containingFile: string,
) => { resolved: string | undefined; external: boolean };

function makeEdge(
  source: ts.SourceFile,
  node: ts.Node,
  specifier: string,
  typeOnly: boolean,
  dynamic: DynamicKind,
  resolve: ResolveSpecifier,
): Edge {
  const { resolved, external } = resolve(specifier, source.fileName);
  const { line, col } = positionOf(source, node);
  return {
    from: source.fileName,
    to: resolved ?? specifier,
    specifier,
    external,
    typeOnly,
    dynamic,
    line,
    col,
    node,
  };
}

/** `import { type A, type B }` is as type-only as `import type { A, B }`. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0) {
    return bindings.elements.every((element) => element.isTypeOnly);
  }
  return false;
}

function literalSpecifier(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function collectImplementedPorts(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const ports = new Set<string>();

  const recordName = (node: ts.Node): void => {
    const symbol = checker.getSymbolAtLocation(node);
    // Resolve through the alias so `import { BlobStore as BS }` still matches `BlobStore`.
    const target =
      symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    if (target) ports.add(target.getName());
    else if (ts.isIdentifier(node)) ports.add(node.text);
  };

  const typeReferenceName = (type: ts.TypeNode): ts.Node | undefined =>
    ts.isTypeReferenceNode(type)
      ? ts.isQualifiedName(type.typeName)
        ? type.typeName.right
        : type.typeName
      : undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
        for (const type of clause.types) recordName(type.expression);
      }
    }
    // `const store: BlobStore = ...` and `... satisfies BlobStore` — the factory-function style
    // this codebase and its consumers actually use, where there is no class to hang a clause on.
    if (ts.isVariableDeclaration(node) && node.type) {
      const name = typeReferenceName(node.type);
      if (name) recordName(name);
    }
    if (ts.isFunctionDeclaration(node) && node.type) {
      const name = typeReferenceName(node.type);
      if (name) recordName(name);
    }
    if (ts.isSatisfiesExpression(node)) {
      const name = typeReferenceName(node.type);
      if (name) recordName(name);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return [...ports].sort();
}

function collectExports(source: ts.SourceFile, checker: ts.TypeChecker): string[] {
  const symbol = checker.getSymbolAtLocation(source);
  if (!symbol) return [];
  return checker
    .getExportsOfModule(symbol)
    .map((exported) => exported.getName())
    .sort();
}

export function extractFacts(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  resolve: ResolveSpecifier,
): FileFacts {
  const edges: Edge[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalSpecifier(node.moduleSpecifier);
      if (specifier !== undefined) {
        edges.push(makeEdge(source, node, specifier, isTypeOnlyImport(node), 'none', resolve));
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = literalSpecifier(node.moduleSpecifier);
      if (specifier !== undefined) {
        edges.push(makeEdge(source, node, specifier, node.isTypeOnly, 'none', resolve));
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = literalSpecifier(node.moduleReference.expression);
      if (specifier !== undefined) {
        edges.push(makeEdge(source, node, specifier, node.isTypeOnly, 'none', resolve));
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const argument = node.arguments[0];
        const specifier = literalSpecifier(argument);
        if (specifier !== undefined) {
          edges.push(
            makeEdge(source, node, specifier, false, isDynamicImport ? 'literal' : 'none', resolve),
          );
        } else if (isDynamicImport) {
          // A computed specifier resolves to nothing. Report it anyway, with the expression text
          // as the specifier, so the ban has something to point at.
          const text = argument ? argument.getText(source) : '';
          const { line, col } = positionOf(source, node);
          edges.push({
            from: source.fileName,
            to: text,
            specifier: text,
            external: false,
            typeOnly: false,
            dynamic: 'computed',
            line,
            col,
            node,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);

  return {
    file: source.fileName,
    edges,
    implementsPorts: collectImplementedPorts(source, checker),
    exports: collectExports(source, checker),
  };
}

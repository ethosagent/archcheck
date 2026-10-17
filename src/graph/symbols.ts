/**
 * What a name actually refers to, as a qualified symbol: `module#member`.
 *
 * Why this exists: `banned-syntax` decided `member-access` and `new-expression` by comparing
 * SOURCE TEXT, so ordinary code evaded a ban without trying. `import { exec as run }` defeated a
 * ban on `child_process.exec`, `import * as cp` matched only if the target happened to be spelled
 * `cp.exec`, and `const { log } = console` defeated a ban on `console.log`. Three ways to lose a
 * rule by renaming a local.
 *
 * This is a FACT about the program, which is why it lives in the graph rather than beside the
 * rule kinds: the graph observes and reports, and "this identifier refers to that export" is an
 * observation. The judgement about whether that symbol is banned stays in the contract.
 *
 * What a caller must know: it needs a real `ts.TypeChecker`, so it only runs while the graph is
 * being READ. That is why its answers are stored as syntax facts: a graph restored from a written
 * report has no checker, and the facts are how an ingested run still sees what a name refers to.
 */
import ts from 'typescript';

function qualify(module: string, path: readonly string[]): string | undefined {
  const joined = path.filter((part) => part.length > 0).join('.');
  return joined.length === 0 ? undefined : `${module}#${joined}`;
}

// A `JSDocImportTag` carries a module specifier too, and TypeScript types an import clause's
// parent as either. Both are read the same way.
function specifierOf(declaration: ts.ImportDeclaration | ts.JSDocImportTag): string | undefined {
  const specifier = declaration.moduleSpecifier;
  return ts.isStringLiteral(specifier) ? specifier.text : undefined;
}

/**
 * The qualified symbol a node refers to, or undefined when nothing can be said.
 *
 * The property chain is read first, right to left, so `cp.exec` and `console.log` both arrive
 * here as a root identifier plus a path. The root is then resolved through its own declaration —
 * the LOCAL one, not the aliased target, because the module specifier is written on the import
 * rather than on the thing imported.
 */
export function resolveQualified(node: ts.Node, checker: ts.TypeChecker): string | undefined {
  const members: string[] = [];
  let root: ts.Node = node;
  while (ts.isPropertyAccessExpression(root)) {
    members.unshift(root.name.text);
    root = root.expression;
  }
  if (!ts.isIdentifier(root)) return undefined;

  const local = checker.getSymbolAtLocation(root);
  const declaration = local?.declarations?.[0];
  if (declaration === undefined) return undefined;

  // `import { exec as run }` — the export name is the propertyName when there is an alias.
  if (ts.isImportSpecifier(declaration)) {
    const module = specifierOf(declaration.parent.parent.parent);
    const exported = declaration.propertyName ?? declaration.name;
    return module === undefined ? undefined : qualify(module, [exported.text, ...members]);
  }

  // `import * as cp` — the member path is whatever was written after the namespace.
  if (ts.isNamespaceImport(declaration)) {
    const module = specifierOf(declaration.parent.parent);
    return module === undefined ? undefined : qualify(module, members);
  }

  // `import fs from 'node:fs'` — the default export, under its own name.
  if (ts.isImportClause(declaration)) {
    const module = specifierOf(declaration.parent);
    return module === undefined ? undefined : qualify(module, ['default', ...members]);
  }

  // `const { log } = console` — a local bound out of something else. Resolve what it came FROM
  // and append the property it was bound to, so the ban still sees `globalThis#console.log`.
  if (ts.isBindingElement(declaration)) {
    const variable = declaration.parent.parent;
    const property = declaration.propertyName ?? declaration.name;
    if (!ts.isVariableDeclaration(variable) || variable.initializer === undefined) return undefined;
    if (!ts.isIdentifier(property)) return undefined;
    const base = resolveQualified(variable.initializer, checker);
    return base === undefined ? undefined : [base, property.text, ...members].join('.');
  }

  // Declared by nobody's import: a global. `console.log` is `globalThis#console.log`.
  return qualify('globalThis', [root.text, ...members]);
}

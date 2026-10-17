import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { collectSyntax } from './syntax.js';
import { requestKey, type SyntaxRequest } from './syntaxRequest.js';

/** A template substitution opener, built rather than written, so it is not a template. */
const SUB = ['$', '{'].join('');

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest, true);
}

/**
 * One request, answered against one parsed file.
 *
 * No checker is passed, which is deliberate for every case below: these are the TEXT paths, the
 * ones a manifest written before #7 still uses, and they must keep behaving exactly as they did
 * when this walk lived inside the contract. The symbol paths need a real program and are covered
 * where one exists, in src/probes/lint.test.ts.
 */
function occurrences(request: SyntaxRequest, source: string) {
  return collectSyntax(parse(source), undefined, [request])[requestKey(request)] ?? [];
}

describe('member-access', () => {
  const request: SyntaxRequest = { construct: 'member-access', target: 'Date.now' };

  test('catches the banned access and reports its position', () => {
    const found = occurrences(request, 'export const t = () => Date.now();\n');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 1, snippet: 'Date.now' });
  });

  test('does not catch a different member of the same object', () => {
    expect(occurrences(request, 'export const t = () => Date.parse("x");\n')).toHaveLength(0);
  });

  test('a bare object target catches every member of it', () => {
    const consoleBan: SyntaxRequest = { construct: 'member-access', target: 'console' };
    const found = occurrences(
      consoleBan,
      'export const f = () => { console.warn(1); console.error(2); };\n',
    );
    expect(found).toHaveLength(2);
  });

  test('one access chain is one occurrence, however much longer than the target it is', () => {
    // The 0.2.0 bug: `process.env.B.C` matched as itself AND as its inner `process.env.B` and
    // `process.env`, because each is a PropertyAccessExpression whose text starts with the target.
    const env: SyntaxRequest = { construct: 'member-access', target: 'process.env' };
    const found = occurrences(env, 'process.env.A;\nprocess.env.B.C;\n');
    expect(found.map((o) => o.snippet)).toEqual(['process.env.A', 'process.env.B.C']);
  });

  test('a call on a longer chain is still one occurrence', () => {
    const consoleBan: SyntaxRequest = { construct: 'member-access', target: 'console' };
    expect(occurrences(consoleBan, 'console.log(x);\n')).toHaveLength(1);
    expect(occurrences(consoleBan, 'console.log.call(null, x);\n')).toHaveLength(1);
  });

  test('an optional-chained member is its own occurrence of the target, not a longer chain', () => {
    const env: SyntaxRequest = { construct: 'member-access', target: 'process.env' };
    expect(occurrences(env, 'process.env?.A;\n').map((o) => o.snippet)).toEqual(['process.env']);
  });
});

describe('new-expression', () => {
  test('catches the banned construction', () => {
    const found = occurrences(
      { construct: 'new-expression', target: 'Date' },
      'export const d = () => new Date();\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toBe('new Date()');
  });
});

describe('string-literal-comparison', () => {
  const request: SyntaxRequest = { construct: 'string-literal-comparison' };

  test('catches === and !== against a literal, on either side', () => {
    expect(occurrences(request, 'export const a = (k: string) => k === "x";\n')).toHaveLength(1);
    expect(occurrences(request, 'export const b = (k: string) => "x" !== k;\n')).toHaveLength(1);
  });

  test('leaves a comparison between two values alone', () => {
    expect(
      occurrences(request, 'export const c = (a: string, b: string) => a === b;\n'),
    ).toHaveLength(0);
  });
});

describe('empty-catch', () => {
  const request: SyntaxRequest = { construct: 'empty-catch' };

  test('catches a truly empty catch', () => {
    expect(
      occurrences(request, 'export const f = () => { try { g(); } catch {} };\n'),
    ).toHaveLength(1);
  });

  test('an EXPLAINED silence is allowed — the rule says so, and this was a real false positive', () => {
    const explained =
      'export const f = () => { try { g(); } catch {\n  // safe: g only reads a cache\n} };\n';
    expect(occurrences(request, explained)).toHaveLength(0);
  });

  test('a catch that handles the error is allowed', () => {
    expect(
      occurrences(request, 'export const f = () => { try { g(); } catch (e) { throw e; } };\n'),
    ).toHaveLength(0);
  });
});

describe('suppression-comment', () => {
  const request: SyntaxRequest = { construct: 'suppression-comment' };

  test('catches an inline suppression in a comment', () => {
    const found = occurrences(request, '// eslint-disable-next-line no-x\nexport const a = 1;\n');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  test('catches it in a block comment too', () => {
    expect(
      occurrences(request, '/* biome-ignore lint/x: why */\nexport const a = 1;\n'),
    ).toHaveLength(1);
  });

  test('does NOT catch the words inside a string or regex — the false positive that found this bug', () => {
    const literal = 'export const PATTERN = /(eslint-disable|biome-ignore)/;\n';
    expect(occurrences(request, literal)).toHaveLength(0);
    expect(occurrences(request, 'export const s = "biome-ignore";\n')).toHaveLength(0);
  });

  test('a template literal with a substitution does not hide every comment after it', () => {
    // The 0.2.0 bug: a raw scanner never rescans the `}` that closes a substitution as template
    // text, so everything after the first one was mis-tokenized and no later comment was found.
    const source = [
      '// biome-ignore lint/a: before',
      `export const a = (x: string) => \`id-${SUB}x}-end\`;`,
      '// biome-ignore lint/b: after',
      'export const b = 1; // eslint-disable-line no-x',
      '',
    ].join('\n');
    expect(occurrences(request, source).map((o) => o.line)).toEqual([1, 3, 4]);
  });

  test('a nested template does not hide a later comment either', () => {
    const source = [
      `export const a = (x: string) => \`outer ${SUB}\`inner ${SUB}x}\`} tail\`;`,
      '/* @ts-ignore */ export const b = 1;',
      '',
    ].join('\n');
    expect(occurrences(request, source).map((o) => o.line)).toEqual([2]);
  });

  test('comment-shaped text INSIDE a template is not a comment', () => {
    const source = [
      'export const a = `// biome-ignore in a plain template`;',
      `export const b = (x: string) => \`head // eslint-disable ${SUB}x} tail /* @ts-ignore */\`;`,
      '',
    ].join('\n');
    expect(occurrences(request, source)).toHaveLength(0);
  });

  test('a regex literal containing // is not a comment, and does not hide a later one', () => {
    const source = [
      'export const r = /[//] biome-ignore/;',
      '// biome-ignore lint/c: real',
      'export const c = 1;',
      '',
    ].join('\n');
    expect(occurrences(request, source).map((o) => o.line)).toEqual([2]);
  });

  test('JSX text that looks like a comment is not one', () => {
    const source = 'export const e = <p>// biome-ignore is text here</p>;\n';
    const tsx = ts.createSourceFile('sample.tsx', source, ts.ScriptTarget.Latest, true);
    expect(collectSyntax(tsx, undefined, [request])[requestKey(request)]).toHaveLength(0);
  });
});

describe('string-literal', () => {
  const request: SyntaxRequest = { construct: 'string-literal' };

  test('collects a plain string the reader can act on', () => {
    const found = occurrences(request, 'export const u = "https://api.example.com";\n');
    expect(found.map((o) => o.snippet)).toEqual(['https://api.example.com']);
  });

  test('a module specifier is not a hard-coded value', () => {
    expect(occurrences(request, 'import { a } from "./a.js";\n')).toHaveLength(0);
    expect(occurrences(request, 'export { b } from "./b.js";\n')).toHaveLength(0);
  });

  test('a string inside a literal type says what a value MAY be, not what it is', () => {
    expect(occurrences(request, 'export type Mode = "fast" | "slow";\n')).toHaveLength(0);
  });

  test('every literal is collected, because the pattern is the contract\u2019s decision', () => {
    // Collection is deliberately pattern-free: two rules with different patterns share one pass,
    // and editing a pattern does not invalidate a cache entry.
    const found = occurrences(request, 'export const two = ["a", "b"];\n');
    expect(found.map((o) => o.snippet)).toEqual(['a', 'b']);
  });
});

describe('module-mutable-state', () => {
  const request: SyntaxRequest = { construct: 'module-mutable-state' };

  test('a top-level let is module state', () => {
    expect(occurrences(request, 'let count = 0;\n').map((o) => o.snippet)).toEqual(['let count']);
  });

  test('a top-level const is not', () => {
    expect(occurrences(request, 'const count = 0;\n')).toHaveLength(0);
  });

  test('a let inside a function is not module state', () => {
    expect(occurrences(request, 'export const f = () => { let n = 0; return n; };\n')).toHaveLength(
      0,
    );
  });
});

describe('declared-field-call', () => {
  const request: SyntaxRequest = { construct: 'declared-field-call', target: 'registerRoute' };

  test('reports the call with the properties its object arguments declare', () => {
    const source = 'registerRoute({ path: "/a", permission: "read" });\n';
    const found = occurrences(request, source);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toEqual([
      { name: 'path', value: '/a' },
      { name: 'permission', value: 'read' },
    ]);
  });

  test('a non-literal value is collected with no value, so nothing is guessed from it', () => {
    const found = occurrences(request, 'registerRoute({ permission: READ });\n');
    expect(found[0]?.fields).toEqual([{ name: 'permission' }]);
  });

  test('a call with no object argument declares nothing, which is the finding', () => {
    expect(occurrences(request, 'registerRoute("/a");\n')[0]?.fields).toEqual([]);
  });

  test('the callee is matched by text, the way a manifest writes it', () => {
    const nested: SyntaxRequest = { construct: 'declared-field-call', target: 'router.get' };
    expect(occurrences(nested, 'router.get({ permission: "read" });\n')).toHaveLength(1);
    expect(occurrences(nested, 'router.post({ permission: "read" });\n')).toHaveLength(0);
  });
});

describe('one walk answers every request', () => {
  test('two requests are both answered from a single traversal', () => {
    const both: SyntaxRequest[] = [
      { construct: 'empty-catch' },
      { construct: 'member-access', target: 'console' },
    ];
    const source = 'export const f = () => { try { console.log(1); } catch {} };\n';
    const facts = collectSyntax(parse(source), undefined, both);
    expect(facts['empty-catch']).toHaveLength(1);
    expect(facts['member-access console']).toHaveLength(1);
  });

  test('a requested key is present and empty when nothing was found', () => {
    // "found nothing" and "never asked" must not look the same: a rule reading a key nobody
    // collected would report a clean file.
    const facts = collectSyntax(parse('export const a = 1;\n'), undefined, [
      { construct: 'empty-catch' },
    ]);
    expect(Object.keys(facts)).toEqual(['empty-catch']);
    expect(facts['empty-catch']).toEqual([]);
  });

  test('asking nothing collects nothing', () => {
    expect(collectSyntax(parse('let n = 0;\n'), undefined, [])).toEqual({});
  });
});

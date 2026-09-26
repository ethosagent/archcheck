import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import type { Rule } from '../types.js';
import {
  BANNED_CONSTRUCTS,
  type BannedSyntaxParams,
  bannedSyntaxApplies,
  bannedSyntaxContract,
  findBannedOccurrences,
} from './banned-syntax.js';

/** The text of a computed dynamic import, built rather than written, so it is not a template. */
const COMPUTED_SPECIFIER = ['`./', '${', 'x}.js`'].join('');
/** A template substitution opener, built for the same reason. */
const SUB = ['$', '{'].join('');

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('sample.ts', source, ts.ScriptTarget.Latest, true);
}

function occurrences(params: BannedSyntaxParams, source: string) {
  return findBannedOccurrences(params, parse(source), []);
}

const rule = (params: Record<string, unknown>): Rule => ({
  id: 'a-ban',
  kind: 'banned-syntax',
  statement: 'this construct is banned here',
  severity: 'error',
  confidence: 'deterministic',
  params,
  remedy: { summary: 'do it the other way' },
});

describe('member-access', () => {
  const params: BannedSyntaxParams = {
    appliesTo: 'src/**',
    selector: 'member-access',
    target: 'Date.now',
  };

  test('catches the banned access and reports its position', () => {
    const found = occurrences(params, 'export const t = () => Date.now();\n');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 1, snippet: 'Date.now' });
  });

  test('does not catch a different member of the same object', () => {
    expect(occurrences(params, 'export const t = () => Date.parse("x");\n')).toHaveLength(0);
  });

  test('a bare object target catches every member of it', () => {
    const consoleBan: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'member-access',
      target: 'console',
    };
    const found = occurrences(
      consoleBan,
      'export const f = () => { console.warn(1); console.error(2); };\n',
    );
    expect(found).toHaveLength(2);
  });

  test('one access chain is one occurrence, however much longer than the target it is', () => {
    // The 0.2.0 bug: `process.env.B.C` matched as itself AND as its inner `process.env.B` and
    // `process.env`, because each is a PropertyAccessExpression whose text starts with the target.
    const env: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'member-access',
      target: 'process.env',
    };
    const found = occurrences(env, 'process.env.A;\nprocess.env.B.C;\n');
    expect(found.map((o) => o.snippet)).toEqual(['process.env.A', 'process.env.B.C']);
  });

  test('a call on a longer chain is still one occurrence', () => {
    const consoleBan: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'member-access',
      target: 'console',
    };
    expect(occurrences(consoleBan, 'console.log(x);\n')).toHaveLength(1);
    expect(occurrences(consoleBan, 'console.log.call(null, x);\n')).toHaveLength(1);
  });

  test('an optional-chained member is its own occurrence of the target, not a longer chain', () => {
    const env: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'member-access',
      target: 'process.env',
    };
    expect(occurrences(env, 'process.env?.A;\n').map((o) => o.snippet)).toEqual(['process.env']);
  });
});

describe('new-expression', () => {
  test('catches the banned construction', () => {
    const found = occurrences(
      { appliesTo: 'src/**', selector: 'new-expression', target: 'Date' },
      'export const d = () => new Date();\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toBe('new Date()');
  });
});

describe('string-literal-comparison', () => {
  const params: BannedSyntaxParams = { appliesTo: 'src/**', selector: 'string-literal-comparison' };

  test('catches === and !== against a literal, on either side', () => {
    expect(occurrences(params, 'export const a = (k: string) => k === "x";\n')).toHaveLength(1);
    expect(occurrences(params, 'export const b = (k: string) => "x" !== k;\n')).toHaveLength(1);
  });

  test('leaves a comparison between two values alone', () => {
    expect(
      occurrences(params, 'export const c = (a: string, b: string) => a === b;\n'),
    ).toHaveLength(0);
  });
});

describe('empty-catch', () => {
  const params: BannedSyntaxParams = { appliesTo: 'src/**', selector: 'empty-catch' };

  test('catches a truly empty catch', () => {
    expect(occurrences(params, 'export const f = () => { try { g(); } catch {} };\n')).toHaveLength(
      1,
    );
  });

  test('an EXPLAINED silence is allowed — the rule says so, and this was a real false positive', () => {
    const explained =
      'export const f = () => { try { g(); } catch {\n  // safe: g only reads a cache\n} };\n';
    expect(occurrences(params, explained)).toHaveLength(0);
  });

  test('a catch that handles the error is allowed', () => {
    expect(
      occurrences(params, 'export const f = () => { try { g(); } catch (e) { throw e; } };\n'),
    ).toHaveLength(0);
  });
});

describe('suppression-comment', () => {
  const params: BannedSyntaxParams = { appliesTo: 'src/**', selector: 'suppression-comment' };

  test('catches an inline suppression in a comment', () => {
    const found = occurrences(params, '// eslint-disable-next-line no-x\nexport const a = 1;\n');
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  test('catches it in a block comment too', () => {
    expect(
      occurrences(params, '/* biome-ignore lint/x: why */\nexport const a = 1;\n'),
    ).toHaveLength(1);
  });

  test('does NOT catch the words inside a string or regex — the false positive that found this bug', () => {
    const literal = 'export const PATTERN = /(eslint-disable|biome-ignore)/;\n';
    expect(occurrences(params, literal)).toHaveLength(0);
    expect(occurrences(params, 'export const s = "biome-ignore";\n')).toHaveLength(0);
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
    expect(occurrences(params, source).map((o) => o.line)).toEqual([1, 3, 4]);
  });

  test('a nested template does not hide a later comment either', () => {
    const source = [
      `export const a = (x: string) => \`outer ${SUB}\`inner ${SUB}x}\`} tail\`;`,
      '/* @ts-ignore */ export const b = 1;',
      '',
    ].join('\n');
    expect(occurrences(params, source).map((o) => o.line)).toEqual([2]);
  });

  test('comment-shaped text INSIDE a template is not a comment', () => {
    const source = [
      'export const a = `// biome-ignore in a plain template`;',
      `export const b = (x: string) => \`head // eslint-disable ${SUB}x} tail /* @ts-ignore */\`;`,
      '',
    ].join('\n');
    expect(occurrences(params, source)).toHaveLength(0);
  });

  test('a regex literal containing // is not a comment, and does not hide a later one', () => {
    const source = [
      'export const r = /[//] biome-ignore/;',
      '// biome-ignore lint/c: real',
      'export const c = 1;',
      '',
    ].join('\n');
    expect(occurrences(params, source).map((o) => o.line)).toEqual([2]);
  });

  test('JSX text that looks like a comment is not one', () => {
    const source = 'export const e = <p>// biome-ignore is text here</p>;\n';
    const tsx = ts.createSourceFile('sample.tsx', source, ts.ScriptTarget.Latest, true);
    expect(findBannedOccurrences(params, tsx, [])).toHaveLength(0);
  });
});

describe('computed-dynamic-import', () => {
  test('reuses the graph reader’s detection rather than re-implementing it', () => {
    const found = findBannedOccurrences(
      { appliesTo: 'src/**', selector: 'computed-dynamic-import' },
      undefined,
      [
        {
          from: '/r/a.ts',
          to: COMPUTED_SPECIFIER,
          specifier: COMPUTED_SPECIFIER,
          external: false,
          typeOnly: false,
          dynamic: 'computed',
          line: 7,
          col: 3,
        },
      ],
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(7);
  });
});

describe('appliesTo', () => {
  test('a negated glob carves out an entry point without softening the rule', () => {
    const params: BannedSyntaxParams = {
      appliesTo: ['src/**', '!src/entry/**'],
      selector: 'member-access',
      target: 'console',
    };
    expect(bannedSyntaxApplies(params, 'src/domain/a.ts')).toBe(true);
    expect(bannedSyntaxApplies(params, 'src/entry/main.ts')).toBe(false);
  });
});

describe('validate', () => {
  test('rejects a selector outside the closed set, and lists the set', () => {
    const result = bannedSyntaxContract.validate(
      rule({ appliesTo: 'src/**', selector: 'ImportDeclaration[source.value=/x/]' }),
      { rules: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('params.selector must be one of');
    expect(result.error[0]).toContain('the set is closed so a rule cannot silently match nothing');
  });

  test('requires a target where the construct is meaningless without one', () => {
    const result = bannedSyntaxContract.validate(
      rule({ appliesTo: 'src/**', selector: 'member-access' }),
      { rules: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain("params.target is required for selector 'member-access'");
  });

  test('rejects a target where it means nothing, rather than ignoring it', () => {
    const result = bannedSyntaxContract.validate(
      rule({ appliesTo: 'src/**', selector: 'empty-catch', target: 'Date' }),
      { rules: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('means nothing for selector');
  });

  test('every construct in the closed set validates with its required params', () => {
    for (const selector of BANNED_CONSTRUCTS) {
      const needsTarget = selector === 'member-access' || selector === 'new-expression';
      const result = bannedSyntaxContract.validate(
        rule({ appliesTo: 'src/**', selector, ...(needsTarget ? { target: 'Date' } : {}) }),
        { rules: [] },
      );
      expect(result.ok).toBe(true);
    }
  });
});

describe('emit', () => {
  test('the lint fragment carries the statement and never claims an autofix', () => {
    const fragment = bannedSyntaxContract.emit(
      rule({ appliesTo: 'src/rules/**', selector: 'member-access', target: 'Date.now' }),
      { root: '/r', rules: [] },
    )[0];
    expect(fragment?.target).toBe('lint');
    expect(fragment?.content).toMatchObject({
      files: ['src/rules/**'],
      forbid: 'member-access',
      target: 'Date.now',
      message: 'this construct is banned here — do it the other way',
      autofix: false,
    });
  });
});

import { describe, expect, test } from 'bun:test';
import type { SyntaxFacts } from '../graph/syntax.js';
import type { Rule } from '../types.js';
import {
  BANNED_CONSTRUCTS,
  type BannedSyntaxParams,
  bannedSyntaxApplies,
  bannedSyntaxContract,
  bannedSyntaxRequest,
  findBannedOccurrences,
} from './banned-syntax.js';

/** The text of a computed dynamic import, built rather than written, so it is not a template. */
const COMPUTED_SPECIFIER = ['`./', '${', 'x}.js`'].join('');

/** One occurrence, at a position no assertion below reads. */
const at = (snippet: string) => ({ line: 1, col: 1, snippet });

const rule = (params: Record<string, unknown>): Rule => ({
  id: 'a-ban',
  kind: 'banned-syntax',
  statement: 'this construct is banned here',
  severity: 'error',
  confidence: 'deterministic',
  params,
  remedy: { summary: 'do it the other way' },
});

describe('the question this kind asks of the graph', () => {
  test('a shape selector asks about the shape alone', () => {
    expect(bannedSyntaxRequest({ appliesTo: 'src/**', selector: 'empty-catch' })).toEqual({
      construct: 'empty-catch',
    });
  });

  test('a name selector carries the name', () => {
    const params: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'member-access',
      target: 'console',
    };
    expect(bannedSyntaxRequest(params)).toEqual({ construct: 'member-access', target: 'console' });
  });

  test('the pattern is NOT part of the question', () => {
    // Two rules banning different strings share one collection pass, and editing a pattern does
    // not invalidate a cached file. Which strings matter is decided below, not collected above.
    const one: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'string-literal',
      pattern: 'a',
    };
    const two: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'string-literal',
      pattern: 'b',
    };
    expect(bannedSyntaxRequest(one)).toEqual(bannedSyntaxRequest(two));
  });

  test('the computed-import selector asks nothing, because the graph already reports it', () => {
    const params: BannedSyntaxParams = { appliesTo: 'src/**', selector: 'computed-dynamic-import' };
    expect(bannedSyntaxRequest(params)).toBeUndefined();
  });
});

describe('reading the facts', () => {
  const ban: BannedSyntaxParams = {
    appliesTo: 'src/**',
    selector: 'member-access',
    target: 'console',
  };

  test('occurrences come back under the key this rule asked for', () => {
    const facts: SyntaxFacts = { 'member-access console': [at('console.log')] };
    expect(findBannedOccurrences(ban, facts, [])).toEqual([at('console.log')]);
  });

  test('a file nobody asked about yields nothing, not a clean verdict', () => {
    // The quiet failure this guards: facts collected for a DIFFERENT question must never be read
    // as "this file is clean", which is what a loose lookup would have done.
    expect(findBannedOccurrences(ban, { 'empty-catch': [at('catch {}')] }, [])).toEqual([]);
    expect(findBannedOccurrences(ban, undefined, [])).toEqual([]);
  });

  test('a string-literal ban keeps only the literals its pattern matches', () => {
    const params: BannedSyntaxParams = {
      appliesTo: 'src/**',
      selector: 'string-literal',
      pattern: '^https?://',
    };
    const facts: SyntaxFacts = {
      'string-literal': [at('https://api.example.com'), at('a plain string')],
    };
    const found = findBannedOccurrences(params, facts, []);
    expect(found.map((o) => o.snippet)).toEqual(['https://api.example.com']);
  });

  test('a string-literal ban with no pattern matches nothing, rather than everything', () => {
    const params: BannedSyntaxParams = { appliesTo: 'src/**', selector: 'string-literal' };
    const facts: SyntaxFacts = { 'string-literal': [at('anything at all')] };
    expect(findBannedOccurrences(params, facts, [])).toEqual([]);
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
    // The table is written out rather than derived, so adding a selector to the closed set is a
    // deliberate act here too: a new construct fails this test until somebody states what it
    // needs. That is the point of the set being closed.
    const required: Record<string, Record<string, unknown>> = {
      'member-access': { target: 'Date' },
      'new-expression': { target: 'Date' },
      call: { target: 'globalThis#fetch' },
      reference: { target: 'globalThis#process.env' },
      'string-literal': { pattern: '^https?://' },
    };
    for (const selector of BANNED_CONSTRUCTS) {
      const result = bannedSyntaxContract.validate(
        rule({ appliesTo: 'src/**', selector, ...(required[selector] ?? {}) }),
        { rules: [] },
      );
      expect({ selector, ok: result.ok }).toEqual({ selector, ok: true });
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

import { describe, expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import {
  describeExpectation,
  type NamingParams,
  nameIsWellFormed,
  namingApplies,
  namingContract,
} from './naming.js';

const rule = (params: Record<string, unknown>): Rule => ({
  id: 'a-naming-rule',
  kind: 'naming',
  statement: 'a hook starts with use',
  severity: 'error',
  confidence: 'deterministic',
  params,
  remedy: { summary: 'rename it' },
});

describe('prefixes — the common case', () => {
  const params: NamingParams = { appliesTo: 'src/hooks/**', prefixes: ['use'] };

  test('accepts a prefixed name and rejects one without', () => {
    expect(nameIsWellFormed(params, 'useWorldEvents')).toBe(true);
    expect(nameIsWellFormed(params, 'worldEvents')).toBe(false);
  });

  test('several prefixes are alternatives, as a boolean rule needs', () => {
    const booleans: NamingParams = {
      appliesTo: 'src/**',
      prefixes: ['is', 'has', 'should', 'can'],
    };
    expect(nameIsWellFormed(booleans, 'hasPriceHistory')).toBe(true);
    expect(nameIsWellFormed(booleans, 'priceHistory')).toBe(false);
  });
});

describe('pattern — for what a prefix cannot say', () => {
  const camel: NamingParams = {
    appliesTo: 'src/**',
    target: 'files',
    pattern: '^[a-z][A-Za-z0-9]*\\.tsx?$',
  };

  test('accepts camelCase and rejects kebab-case and PascalCase', () => {
    expect(nameIsWellFormed(camel, 'eventLedger.ts')).toBe(true);
    expect(nameIsWellFormed(camel, 'event-ledger.ts')).toBe(false);
    expect(nameIsWellFormed(camel, 'EventLedger.ts')).toBe(false);
    expect(nameIsWellFormed(camel, 'event_ledger.ts')).toBe(false);
  });

  test('a glob pattern covers the factory and selector families', () => {
    const twin: NamingParams = { appliesTo: 'src/**', pattern: '^createMemory[A-Z]' };
    expect(nameIsWellFormed(twin, 'createMemoryBlobStore')).toBe(true);
    expect(nameIsWellFormed(twin, 'createRemoteBlobStore')).toBe(false);
  });

  test('prefixes and a pattern together are alternatives, not both required', () => {
    const either: NamingParams = {
      appliesTo: 'src/**',
      prefixes: ['use'],
      pattern: '^create[A-Z]',
    };
    expect(nameIsWellFormed(either, 'useThing')).toBe(true);
    expect(nameIsWellFormed(either, 'createThing')).toBe(true);
    expect(nameIsWellFormed(either, 'thing')).toBe(false);
  });
});

describe('appliesTo', () => {
  test('is a path glob, and negation carves out exceptions', () => {
    const params: NamingParams = { appliesTo: ['src/**', '!src/legacy/**'], prefixes: ['use'] };
    expect(namingApplies(params, 'src/hooks/a.ts')).toBe(true);
    expect(namingApplies(params, 'src/legacy/a.ts')).toBe(false);
  });
});

describe('validate', () => {
  test('rejects a rule with neither pattern nor prefixes — it would match nothing', () => {
    const result = namingContract.validate(rule({ appliesTo: 'src/**' }), { rules: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('a naming rule with neither matches nothing');
  });

  test('rejects an invalid regular expression rather than throwing at run time', () => {
    const result = namingContract.validate(rule({ appliesTo: 'src/**', pattern: '([' }), {
      rules: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('not a valid regular expression');
  });

  test('rejects an unknown target', () => {
    const result = namingContract.validate(
      rule({ appliesTo: 'src/**', prefixes: ['use'], target: 'symbols' }),
      { rules: [] },
    );
    expect(result.ok).toBe(false);
  });

  test('accepts a well-formed rule', () => {
    expect(
      namingContract.validate(rule({ appliesTo: 'src/hooks/**', prefixes: ['use'] }), { rules: [] })
        .ok,
    ).toBe(true);
  });
});

describe('describeExpectation', () => {
  test('reads as a sentence for prefixes, a pattern, or both', () => {
    expect(describeExpectation({ appliesTo: 'x', prefixes: ['use'] })).toBe("start with 'use'");
    expect(describeExpectation({ appliesTo: 'x', pattern: '^a' })).toBe('match /^a/');
    expect(describeExpectation({ appliesTo: 'x', prefixes: ['is', 'has'] })).toBe(
      "start with 'is' or 'has'",
    );
  });
});

describe('emit', () => {
  test('the lint fragment carries the statement and never claims an autofix', () => {
    const fragment = namingContract.emit(rule({ appliesTo: 'src/hooks/**', prefixes: ['use'] }), {
      root: '/r',
      rules: [],
    })[0];
    expect(fragment?.content).toMatchObject({
      files: ['src/hooks/**'],
      forbid: 'name-not-matching',
      target: 'exports',
      prefixes: ['use'],
      message: 'a hook starts with use — rename it',
      autofix: false,
    });
  });
});

describe('explain', () => {
  test('names the thing, what was expected, and the remedy', () => {
    const sentence = namingContract.explain(
      {
        ruleId: 'a-naming-rule',
        file: 'src/hooks/badlyNamed.ts',
        identity: 'x',
        evidence: { name: 'worldEvents', namedThing: 'export' },
      },
      rule({ appliesTo: 'src/hooks/**', prefixes: ['use'] }),
      { rules: [] },
    );
    expect(sentence).toContain("export 'worldEvents' does not follow the naming rule");
    expect(sentence).toContain("expected: start with 'use'");
    expect(sentence).toContain('→ rename it');
  });
});

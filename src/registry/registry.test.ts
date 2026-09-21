import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ok, type Result } from '../result.js';
import type { Rule } from '../types.js';
import { open } from './index.js';
import { loadManifestFrom } from './load.js';
import { validateManifest } from './validate.js';

const FIXTURES = join(import.meta.dir, '..', '..', 'fixtures', 'manifests');
const config = (name: string) => join(FIXTURES, name, 'architecture.config.ts');

/** The injected seam, stubbed: the registry is testable with no contract kind present at all. */
const anyParams = (): Result<void> => ok(undefined);

describe('loading', () => {
  test('transpiles and evaluates a TypeScript manifest with no ts-node', () => {
    const loaded = loadManifestFrom(config('valid'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.rules).toHaveLength(3);
    expect(loaded.value.manifest.rules[0]?.id).toBe('domain-no-service-import');
  });

  test('leaves no temporary file behind', () => {
    const dir = join(FIXTURES, 'valid');
    const before = readdirSync(dir).sort();
    loadManifestFrom(config('valid'));
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  test('a syntax error in the manifest is reported as a config problem', () => {
    const loaded = loadManifestFrom(config('broken-syntax'));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.join('\n')).toContain('architecture.config.ts');
  });

  test('a missing manifest names the directory it looked in', () => {
    const opened = open({ cwd: '/', validateParams: anyParams });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error[0]).toContain('no architecture.config.ts found');
  });
});

describe('validation', () => {
  test('a valid manifest loads and indexes', () => {
    const opened = open({ configPath: config('valid'), validateParams: anyParams });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const registry = opened.value;
    expect(registry.all()).toHaveLength(3);
    expect(registry.byId('domain-no-service-import')?.kind).toBe('layers');
    expect(registry.byId('nope')).toBeUndefined();
    expect(registry.byKind('layers')).toHaveLength(1);
  });

  test('a malformed manifest names every offending rule AND field at once', () => {
    const opened = open({ configPath: config('malformed-params'), validateParams: anyParams });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    const joined = opened.error.join('\n');
    expect(joined).toContain("rules[0] 'bad-severity-and-kind': kind");
    expect(joined).toContain("rules[0] 'bad-severity-and-kind': severity");
    expect(joined).toContain('remedy.summary');
    // Total, not first-failure: three separate problems from one rule.
    expect(opened.error.length).toBeGreaterThanOrEqual(3);
  });

  test('a duplicate id fails and names where it was first defined', () => {
    const opened = open({ configPath: config('duplicate-id'), validateParams: anyParams });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.join('\n')).toContain('duplicate id — already defined at rules[0]');
  });

  test('a kind rejects its own params through the injected validator', () => {
    const opened = open({
      configPath: config('valid'),
      validateParams: (rule, rules) => {
        expect(rules.length).toBe(3);
        return rule.kind === 'layers'
          ? { ok: false, error: ["params.mayImport names an unknown layer 'rules'"] }
          : ok(undefined);
      },
    });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error[0]).toContain("domain-no-service-import': params.mayImport names");
  });
});

describe('id immutability', () => {
  test('a removed id without replaces fails the load', () => {
    const opened = open({ configPath: config('removed-id'), validateParams: anyParams });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    const joined = opened.error.join('\n');
    expect(joined).toContain('id disappeared: the-rule-someone-renamed');
    expect(joined).toContain("add a rule with replaces: 'the-rule-someone-renamed'");
  });
});

describe('coverage', () => {
  test('a rule of a kind nothing checks is counted apart, and the percentage falls', () => {
    const opened = open({
      configPath: config('valid'),
      validateParams: anyParams,
      // The facade injects this from the contract registry. Here: judgement is not checkable.
      isCheckable: (rule) => rule.kind !== 'judgement',
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.coverage()).toEqual({
      total: 2,
      deterministic: 1,
      proxy: 0,
      model: 0,
      unchecked: 1,
    });
  });

  test('is counted from the manifest, and excludes rules switched off', () => {
    const opened = open({ configPath: config('valid'), validateParams: anyParams });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // Three rules: one deterministic error, one model advisory, one switched off.
    expect(opened.value.coverage()).toEqual({
      total: 2,
      deterministic: 1,
      proxy: 0,
      model: 1,
      // The registry's default is "every kind is checkable"; the facade injects the truth.
      unchecked: 0,
    });
  });
});

describe('glob well-formedness', () => {
  /** A sound envelope, so only the glob under test can be what fails. */
  const rule = (over: Partial<Rule>): Rule => ({
    id: 'a-rule',
    kind: 'naming',
    statement: 'a name looks like a name',
    severity: 'error',
    confidence: 'deterministic',
    params: { appliesTo: 'src/**' },
    remedy: { summary: 'rename it' },
    ...over,
  });

  test('a malformed glob is rejected, naming the rule, the field and the pattern', () => {
    const result = validateManifest(
      { rules: [rule({ params: { appliesTo: ['src/**', 'src//broken'] } })] },
      anyParams,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const joined = result.error.join('\n');
    expect(joined).toContain("rules[0] 'a-rule': params.appliesTo");
    expect(joined).toContain("'src//broken'");
  });

  test('the shared pass checks every kind that names a glob, in one pass', () => {
    const result = validateManifest(
      {
        rules: [
          rule({ id: 'r-layers', kind: 'layers', params: { name: 'l', match: '/src/**' } }),
          rule({ id: 'r-encap', kind: 'encapsulation', params: { module: 'modules//*' } }),
          rule({ id: 'r-naming', params: { appliesTo: '' } }),
          rule({ id: 'r-banned', kind: 'banned-syntax', params: { appliesTo: 'src/*.{ts' } }),
          rule({ id: 'r-declared', kind: 'declared-field', params: { appliesTo: 'src/*.{a,,b}' } }),
          rule({ id: 'r-judgement', kind: 'judgement', params: { appliesTo: '/x' } }),
          rule({ id: 'r-required', kind: 'required-file', params: { forEach: 'src//ports/*.ts' } }),
        ],
      },
      anyParams,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const id of [
      'r-layers',
      'r-encap',
      'r-naming',
      'r-banned',
      'r-declared',
      'r-judgement',
      'r-required',
    ]) {
      expect(result.error.join('\n')).toContain(`'${id}'`);
    }
  });

  test('an implements match and a rule selector are not globs, and are left alone', () => {
    const result = validateManifest(
      {
        rules: [
          rule({
            id: 'r-implements',
            kind: 'layers',
            params: { name: 'a', match: { implements: 'Port' } },
          }),
          rule({
            id: 'r-selector',
            kind: 'required-file',
            params: { forEach: 'rule[severity=error]', expect: 'fixtures/{id}.ts' },
          }),
        ],
      },
      anyParams,
    );
    expect(result.ok).toBe(true);
  });

  test("an exception's path glob is checked too, and names the exception", () => {
    const result = validateManifest(
      {
        rules: [rule({})],
        exceptions: [
          {
            rule: 'a-rule',
            path: ['src/**', '/src/x/**'],
            owner: 'someone',
            expires: '2099-01-01',
            reason: 'because',
          },
        ],
      },
      anyParams,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const joined = result.error.join('\n');
    expect(joined).toContain('exceptions[0]: path');
    expect(joined).toContain("'/src/x/**'");
  });
});

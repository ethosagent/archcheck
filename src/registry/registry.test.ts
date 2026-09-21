import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ok, type Result } from '../result.js';
import { open } from './index.js';
import { loadManifestFrom } from './load.js';

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
    });
  });
});

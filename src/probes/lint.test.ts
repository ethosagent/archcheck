import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { syntaxRequestsOf } from '../contracts/syntaxRequests.js';
import { createNodeFileSystem } from '../fs/index.js';
import { readGraph } from '../graph/index.js';
import { requestsFingerprint } from '../graph/syntaxRequest.js';
import type { ModuleGraph } from '../graph/types.js';
import type { Result } from '../result.js';
import type { Rule } from '../types.js';
import { DEFAULT_TEST_GLOBS } from '../util/testEdges.js';
import { createLintProbe } from './lint.js';
import type { RunCtx } from './types.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'lint');
const TSCONFIG = join(ROOT, 'tsconfig.json');

/**
 * One graph per set of syntax questions, the way the facade builds it.
 *
 * The rule set decides what the graph collects, so a test that narrows `rules` needs a graph that
 * was asked the narrowed question. Keying the cache on the request fingerprint keeps the reuse —
 * every test that asks the same thing shares one parse — without letting one test read facts
 * collected for another.
 */
const built = new Map<string, Result<ModuleGraph>>();
const graphFor = (rules: readonly Rule[]) => (): Result<ModuleGraph> => {
  const syntax = syntaxRequestsOf(rules);
  const key = requestsFingerprint(syntax);
  const already = built.get(key);
  if (already !== undefined) return already;
  const fresh = readGraph({ root: ROOT, tsconfigPath: TSCONFIG, cache: false, syntax });
  built.set(key, fresh);
  return fresh;
};

const RULES: Rule[] = [
  {
    id: 'no-clock-in-a-rule',
    kind: 'banned-syntax',
    statement: 'a rule is pure: it reads no clock',
    severity: 'error',
    confidence: 'deterministic',
    params: { appliesTo: 'src/rules/**', selector: 'member-access', target: 'Date.now' },
    remedy: { summary: 'take the timestamp as an argument' },
  },
  {
    id: 'no-computed-dynamic-import',
    kind: 'banned-syntax',
    statement: 'a dynamic import names its module literally',
    severity: 'error',
    confidence: 'deterministic',
    params: { appliesTo: 'src/**', selector: 'computed-dynamic-import' },
    remedy: { summary: 'import the candidates statically' },
  },
  {
    id: 'hooks-start-with-use',
    kind: 'naming',
    statement: 'a hook starts with use',
    severity: 'error',
    confidence: 'deterministic',
    params: { appliesTo: 'src/hooks/**', target: 'exports', prefixes: ['use'] },
    remedy: { summary: 'rename it' },
  },
  {
    id: 'filenames-are-camel-case',
    kind: 'naming',
    statement: 'a filename is camelCase',
    severity: 'error',
    confidence: 'deterministic',
    params: { appliesTo: 'src/**', target: 'files', pattern: '^[a-z][A-Za-z0-9]*\\.tsx?$' },
    remedy: { summary: 'rename the file' },
  },
];

function ctx(overrides: Partial<RunCtx> = {}): RunCtx {
  const rules = overrides.rules ?? RULES;
  return {
    root: ROOT,
    tsconfigPath: TSCONFIG,
    fs: createNodeFileSystem(ROOT),
    configPath: 'architecture.config.ts',
    tests: DEFAULT_TEST_GLOBS,
    graph: graphFor(rules),
    ...overrides,
    rules,
  };
}

const probe = createLintProbe();

describe('run', () => {
  test('evaluates naming and syntax rules with no external linter present', async () => {
    const findings = await probe.run(ctx());
    expect(Array.isArray(findings)).toBe(true);
    if (!Array.isArray(findings)) return;
    const byRule = new Map<string, number>();
    for (const finding of findings)
      byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
    expect(byRule.get('no-clock-in-a-rule')).toBe(1);
    expect(byRule.get('no-computed-dynamic-import')).toBe(1);
    expect(byRule.get('hooks-start-with-use')).toBe(1);
    expect(byRule.get('filenames-are-camel-case')).toBe(1);
  });

  test('the clean files produce nothing', async () => {
    const findings = await probe.run(ctx());
    if (!Array.isArray(findings)) return;
    const files = new Set(findings.map((f) => f.file));
    expect(files).not.toContain('src/rules/pure.ts');
    expect(files).not.toContain('src/hooks/useWorldEvents.ts');
  });

  test('an entry point carved out by a negated glob is left alone', async () => {
    const consoleRule: Rule = {
      ...RULES[0],
      id: 'no-console-outside-an-entry-point',
      params: {
        appliesTo: ['src/**', '!src/entry/**'],
        selector: 'member-access',
        target: 'console',
      },
    } as Rule;
    const findings = await probe.run(ctx({ rules: [consoleRule] }));
    if (!Array.isArray(findings)) return;
    expect(findings.map((f) => f.file)).not.toContain('src/entry/main.ts');
    // But it still fires where it applies, so the rule is live rather than merely quiet.
    expect(findings.map((f) => f.file)).toContain('src/rules/impure.ts');
  });

  test('evidence carries the snippet, not the line — so it survives a move', async () => {
    const findings = await probe.run(ctx({ rules: [RULES[0] as Rule] }));
    if (!Array.isArray(findings)) return;
    expect(findings[0]?.evidence).toEqual({
      file: 'src/rules/impure.ts',
      construct: 'member-access',
      snippet: 'Date.now',
    });
  });

  test('diff scoping excludes unchanged files', async () => {
    const findings = await probe.run(ctx({ changed: ['src/rules/pure.ts'] }));
    if (!Array.isArray(findings)) return;
    expect(findings).toEqual([]);
  });

  test('no naming or syntax rules means no work, not a crash', async () => {
    expect(await probe.run(ctx({ rules: [] }))).toEqual([]);
  });

  test('a graph that could not be built is a skip with a reason', async () => {
    const result = await probe.run(ctx({ graph: () => ({ ok: false, error: ['no tsconfig'] }) }));
    expect(result).toEqual({ skipped: true, reason: 'no tsconfig' });
  });
});

describe('ingest', () => {
  test('maps an external linter’s report back by rule id', () => {
    const findings = probe.ingest?.(
      {
        schemaVersion: 1,
        findings: [
          {
            ruleId: 'hooks-start-with-use',
            file: 'src/hooks/x.ts',
            line: 3,
            evidence: { name: 'thing' },
          },
        ],
      },
      ctx(),
    );
    expect(findings).toEqual([
      {
        ruleId: 'hooks-start-with-use',
        file: 'src/hooks/x.ts',
        line: 3,
        evidence: { file: 'src/hooks/x.ts', name: 'thing' },
        identity: '',
      },
    ]);
  });

  test('drops a finding for a rule the manifest does not define', () => {
    const findings = probe.ingest?.(
      {
        schemaVersion: 1,
        findings: [
          { ruleId: 'hooks-start-with-use', file: 'a.ts' },
          { ruleId: 'some-linters-own-rule', file: 'a.ts' },
        ],
      },
      ctx(),
    );
    // Mapped BY RULE ID: a linter's own rules are not archcheck's business, and forwarding them
    // would make the normaliser throw on a rule the manifest never declared.
    expect(findings).toHaveLength(1);
    expect(findings?.[0]?.ruleId).toBe('hooks-start-with-use');
  });

  test('a report of the wrong schema version is a hard error', () => {
    expect(() => probe.ingest?.({ schemaVersion: 2, findings: [] }, ctx())).toThrow(
      'not a lint report of schemaVersion 1',
    );
  });
});

describe('every rule the fixture declares actually fires', () => {
  /**
   * A rule that matches nothing passes every build and looks exactly like compliance (plan 12).
   * This is the check that catches it: the lint fixture declares nine rules, and all nine must
   * have something to find. It caught a real regression — fixing the empty-catch false positive
   * made the fixture's catch an explained silence, so that rule quietly stopped firing.
   */
  test('all nine rules in the lint fixture have a planted violation', async () => {
    const { loadManifestFrom } = await import('../registry/load.js');
    const loaded = loadManifestFrom(join(ROOT, 'architecture.config.ts'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const declared = loaded.value.manifest.rules.filter((rule) => rule.severity !== 'off');
    const findings = await probe.run(ctx({ rules: declared }));
    if (!Array.isArray(findings)) throw new Error('the probe skipped');

    const fired = new Set(findings.map((finding) => finding.ruleId));
    const silent = declared.map((rule) => rule.id).filter((id) => !fired.has(id));
    expect(silent).toEqual([]);
    expect(fired.size).toBe(9);
  });
});

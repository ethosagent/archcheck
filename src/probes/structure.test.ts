import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryFileSystem, createNodeFileSystem, type FileSystem } from '../fs/index.js';
import { readGraph } from '../graph/index.js';
import type { ModuleGraph } from '../graph/types.js';
import { ok, type Result } from '../result.js';
import type { Rule } from '../types.js';
import { DEFAULT_TEST_GLOBS } from '../util/testEdges.js';
import { createStructureProbe } from './structure.js';
import type { RunCtx } from './types.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'structure');
const TSCONFIG = join(ROOT, 'tsconfig.json');

const TWIN_RULE: Rule = {
  id: 'every-port-has-a-memory-twin',
  kind: 'required-file',
  statement: 'every port ships a memory twin',
  severity: 'error',
  confidence: 'deterministic',
  params: { forEach: 'src/ports/*.ts', expect: 'src/adapters/memory{Base}.ts' },
  remedy: { summary: 'write the twin beside the real implementation' },
};

const PERMISSION_RULE: Rule = {
  id: 'endpoints-declare-a-permission',
  kind: 'declared-field',
  statement: 'every endpoint declares the permission it needs',
  severity: 'error',
  confidence: 'deterministic',
  params: {
    appliesTo: 'src/routes/**',
    on: 'registerRoute',
    field: 'permission',
    allowed: ['events.read', 'events.write'],
  },
  remedy: { summary: 'add permission: to the route spec' },
};

let built: Result<ModuleGraph> | undefined;
const sharedGraph = (): Result<ModuleGraph> => {
  built ??= readGraph({ root: ROOT, tsconfigPath: TSCONFIG, cache: false });
  return built;
};

function ctx(overrides: Partial<RunCtx> = {}): RunCtx {
  return {
    root: ROOT,
    tsconfigPath: TSCONFIG,
    rules: [TWIN_RULE, PERMISSION_RULE],
    fs: createNodeFileSystem(ROOT),
    configPath: 'architecture.config.ts',
    tests: DEFAULT_TEST_GLOBS,
    graph: sharedGraph,
    ...overrides,
  };
}

const probe = createStructureProbe();

describe('required-file', () => {
  test('reports the missing twin against the PORT, not the directory searched', async () => {
    const findings = await probe.run(ctx({ rules: [TWIN_RULE] }));
    expect(Array.isArray(findings)).toBe(true);
    if (!Array.isArray(findings)) return;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('src/ports/clock.ts');
    expect(findings[0]?.evidence).toEqual({
      subject: 'src/ports/clock.ts',
      expected: 'src/adapters/memoryClock.ts',
      label: 'src/ports/clock.ts',
    });
  });

  test('the port that HAS a twin produces nothing', async () => {
    const findings = await probe.run(ctx({ rules: [TWIN_RULE] }));
    if (!Array.isArray(findings)) return;
    expect(findings.map((f) => f.file)).not.toContain('src/ports/blobStore.ts');
  });
});

describe('the self-referential case — forEach over the registry', () => {
  const FIXTURE_RULE: Rule = {
    id: 'every-error-rule-has-a-fixture',
    kind: 'required-file',
    statement: 'every error-severity rule has a fixture it catches',
    severity: 'error',
    confidence: 'deterministic',
    params: { forEach: 'rule[severity=error]', expect: 'fixtures/rules/{id}.violation.ts' },
    remedy: { summary: 'add a file that deliberately breaks this rule' },
  };

  test('iterates the registry and reports each rule with no fixture', async () => {
    const fs = createMemoryFileSystem({
      'fixtures/rules/every-port-has-a-memory-twin.violation.ts': '',
    });
    const findings = await probe.run(
      ctx({ rules: [TWIN_RULE, PERMISSION_RULE, FIXTURE_RULE], fs }),
    );
    if (!Array.isArray(findings)) return;

    // The twin rule has a fixture; the other two do not.
    const missing = findings.map((f) => (f.evidence as { subject: string }).subject).sort();
    expect(missing).toEqual(['endpoints-declare-a-permission', 'every-error-rule-has-a-fixture']);
  });

  test('a registry finding is reported against the manifest — the rule has no file of its own', async () => {
    const findings = await probe.run(
      ctx({ rules: [FIXTURE_RULE], fs: createMemoryFileSystem({}) }),
    );
    if (!Array.isArray(findings)) return;
    expect(findings[0]?.file).toBe('architecture.config.ts');
  });

  test('skips a rule that can never fire — a mayImport of * declares scope, not a constraint', async () => {
    const scopeOnly: Rule = {
      id: 'tests-reach-anything',
      kind: 'layers',
      statement: 'a test may reach any layer',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'test', match: 'tests/**', mayImport: '*' },
      remedy: { summary: 'nothing to do' },
    };
    const findings = await probe.run(
      ctx({ rules: [scopeOnly, FIXTURE_RULE], fs: createMemoryFileSystem({}) }),
    );
    if (!Array.isArray(findings)) return;
    const subjects = findings.map((f) => (f.evidence as { subject: string }).subject);
    expect(subjects).not.toContain('tests-reach-anything');
  });

  test('only the selected severity is iterated', async () => {
    const warnRule: Rule = { ...TWIN_RULE, id: 'a-warning', severity: 'warn' };
    const findings = await probe.run(
      ctx({ rules: [warnRule, FIXTURE_RULE], fs: createMemoryFileSystem({}) }),
    );
    if (!Array.isArray(findings)) return;
    const subjects = findings.map((f) => (f.evidence as { subject: string }).subject);
    expect(subjects).not.toContain('a-warning');
  });
});

describe('declared-field', () => {
  test('reports an endpoint with no permission, at its own line', async () => {
    const findings = await probe.run(ctx({ rules: [PERMISSION_RULE] }));
    if (!Array.isArray(findings)) return;
    const absent = findings.filter((f) => f.evidence.problem === 'absent');
    expect(absent).toHaveLength(1);
    expect(absent[0]?.file).toBe('src/routes/eventRoutes.ts');
    expect(absent[0]?.line).toBe(12);
  });

  test('reports a value outside the allowed set, naming what it found', async () => {
    const findings = await probe.run(ctx({ rules: [PERMISSION_RULE] }));
    if (!Array.isArray(findings)) return;
    const wrong = findings.filter((f) => f.evidence.problem === 'not-allowed');
    expect(wrong).toHaveLength(1);
    expect(wrong[0]?.evidence.found).toBe('god.mode');
  });

  test('the endpoint that declares a legal permission produces nothing', async () => {
    const findings = await probe.run(ctx({ rules: [PERMISSION_RULE] }));
    if (!Array.isArray(findings)) return;
    expect(findings.filter((f) => f.line === 8)).toEqual([]);
  });

  test('diff scoping excludes unchanged files', async () => {
    const findings = await probe.run(
      ctx({ rules: [PERMISSION_RULE], changed: ['src/ports/clock.ts'] }),
    );
    if (!Array.isArray(findings)) return;
    expect(findings).toEqual([]);
  });

  test('a broken graph is a skip with a reason, not a throw', async () => {
    const result = await probe.run(
      ctx({ rules: [PERMISSION_RULE], graph: () => ({ ok: false, error: ['no tsconfig'] }) }),
    );
    expect(result).toEqual({ skipped: true, reason: 'no tsconfig' });
  });

  test('required-file rules alone never need the graph at all', async () => {
    const findings = await probe.run(
      ctx({
        rules: [TWIN_RULE],
        graph: () => {
          throw new Error('the graph must not be built for a filesystem-only run');
        },
      }),
    );
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('node and memory produce identical findings', () => {
  test('for one fixture, through the same probe', async () => {
    const files: Record<string, string> = {
      'src/ports/blobStore.ts': '',
      'src/ports/clock.ts': '',
      'src/adapters/memoryBlobStore.ts': '',
    };
    const memory: FileSystem = createMemoryFileSystem(files);
    const emptyGraph: ModuleGraph = {
      files: [],
      edges: [],
      factsFor: () => undefined,
      sourceFileFor: () => undefined,
      walkedCount: 0,
    };

    const viaNode = await probe.run(ctx({ rules: [TWIN_RULE], graph: () => ok(emptyGraph) }));
    const viaMemory = await probe.run(
      ctx({ rules: [TWIN_RULE], fs: memory, graph: () => ok(emptyGraph) }),
    );
    expect(viaMemory).toEqual(viaNode);
  });
});

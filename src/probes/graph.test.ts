import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readGraph } from '../graph/index.js';
import type { ModuleGraph } from '../graph/types.js';
import { ok, type Result } from '../result.js';
import type { Rule } from '../types.js';
import { createGraphProbe, toGraphReport } from './graph.js';
import type { RunCtx } from './types.js';

const ROOT = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'layered');
const TSCONFIG = join(ROOT, 'tsconfig.json');

function layerRule(id: string, name: string, match: string, mayImport: string[], extra = {}): Rule {
  return {
    id,
    kind: 'layers',
    statement: `${name} imports only what it declares`,
    severity: 'error',
    confidence: 'deterministic',
    params: { name, match, mayImport, ...extra },
    remedy: { summary: 'declare it, or invert the call' },
  };
}

const RULES: Rule[] = [
  layerRule('contracts-import-nothing', 'contracts', 'packages/contracts/**', []),
  layerRule('rules-are-pure', 'rules', 'modules/*/rules/**', ['contracts']),
  layerRule('domain-no-service-import', 'domain', 'modules/*/domain/**', ['contracts', 'rules'], {
    catchesUnlayered: true,
  }),
  layerRule('services-orchestrate-only', 'service', 'modules/*/services/**', [
    'contracts',
    'rules',
    'domain',
    'repository',
  ]),
  layerRule('repositories-reach-contracts-only', 'repository', 'modules/*/repositories/**', [
    'contracts',
  ]),
];

let built: Result<ModuleGraph> | undefined;
function sharedGraph(): Result<ModuleGraph> {
  built ??= readGraph({ root: ROOT, tsconfigPath: TSCONFIG, cache: false });
  return built;
}

function ctx(overrides: Partial<RunCtx> = {}): RunCtx {
  return { root: ROOT, tsconfigPath: TSCONFIG, rules: RULES, graph: sharedGraph, ...overrides };
}

const probe = createGraphProbe();

describe('run', () => {
  test('finds the planted violation, with the right evidence fields', async () => {
    const findings = await probe.run(ctx());
    expect(Array.isArray(findings)).toBe(true);
    if (!Array.isArray(findings)) return;

    const edgeViolation = findings.find(
      (f) => f.ruleId === 'domain-no-service-import' && !f.evidence.unlayered,
    );
    expect(edgeViolation).toBeDefined();
    expect(edgeViolation?.file).toBe('modules/ledger/domain/supersede.ts');
    expect(edgeViolation?.evidence).toEqual({
      from: 'modules/ledger/domain/supersede.ts',
      to: 'modules/ledger/services/write.ts',
      fromLayer: 'domain',
      toLayer: 'service',
      specifier: '../services/write.js',
    });
    expect(edgeViolation?.line).toBe(3);
  });

  test('evidence carries NO rule configuration — that would poison the identity hash', async () => {
    const findings = await probe.run(ctx());
    if (!Array.isArray(findings)) return;
    for (const finding of findings) {
      expect(finding.evidence).not.toHaveProperty('mayImport');
      expect(finding.evidence).not.toHaveProperty('declaredLayers');
    }
  });

  test('the legal edges produce nothing', async () => {
    const findings = await probe.run(ctx());
    if (!Array.isArray(findings)) return;
    const files = findings.map((f) => f.file);
    expect(files).not.toContain('modules/ledger/services/write.ts');
    expect(files).not.toContain('modules/ledger/rules/grounded.ts');
    expect(files).not.toContain('modules/ledger/repositories/ledgerStore.ts');
  });

  test('the undeclared folder is reported as unlayered, once, against the owning rule', async () => {
    const findings = await probe.run(ctx());
    if (!Array.isArray(findings)) return;
    const unlayered = findings.filter((f) => f.evidence.unlayered === true);
    expect(unlayered).toHaveLength(1);
    expect(unlayered[0]?.file).toBe('modules/ledger/undeclared/helper.ts');
    expect(unlayered[0]?.ruleId).toBe('domain-no-service-import');
  });

  test('a probe leaves identity empty — computing it is the normaliser’s job', async () => {
    const findings = await probe.run(ctx());
    if (!Array.isArray(findings)) return;
    expect(findings.every((f) => f.identity === '')).toBe(true);
  });

  test('a broken graph is a skip with a reason, not a throw', async () => {
    const result = await probe.run(ctx({ graph: () => ({ ok: false, error: ['no tsconfig'] }) }));
    expect(result).toEqual({ skipped: true, reason: 'no tsconfig' });
  });

  test('no layers rules means no findings, not a crash', async () => {
    const findings = await probe.run(ctx({ rules: [] }));
    expect(findings).toEqual([]);
  });
});

describe('diff scoping', () => {
  test('excludes edges from unchanged files', async () => {
    const findings = await probe.run(ctx({ changed: ['modules/ledger/services/write.ts'] }));
    if (!Array.isArray(findings)) return;
    expect(findings).toHaveLength(0);
  });

  test('includes the violation when its IMPORTER is in the changed set', async () => {
    const findings = await probe.run(ctx({ changed: ['modules/ledger/domain/supersede.ts'] }));
    if (!Array.isArray(findings)) return;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.toLayer).toBe('service');
  });

  test('an edge INTO a changed file is not a new violation — the importer did not change', async () => {
    // write.ts changed; supersede.ts imports it. The importer is what must change, so nothing fires.
    const findings = await probe.run(ctx({ changed: ['modules/ledger/services/write.ts'] }));
    if (!Array.isArray(findings)) return;
    expect(findings.map((f) => f.file)).not.toContain('modules/ledger/domain/supersede.ts');
  });
});

describe('ingest', () => {
  test('produces findings deep-equal to run(), from a written report', async () => {
    const graph = sharedGraph();
    expect(graph.ok).toBe(true);
    if (!graph.ok) return;

    const report = toGraphReport(graph.value, ROOT);
    const ingested = probe.ingest?.(report, ctx()) ?? [];
    const ran = await probe.run(ctx());
    if (!Array.isArray(ran)) return;

    const key = (f: { ruleId: string; file: string }) => `${f.ruleId}\u0000${f.file}`;
    expect([...ingested].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      [...ran].sort((a, b) => key(a).localeCompare(key(b))),
    );
  });

  test('the report round-trips through JSON without loss', () => {
    const graph = sharedGraph();
    if (!graph.ok) return;
    const report = toGraphReport(graph.value, ROOT);
    const roundTripped = JSON.parse(JSON.stringify(report));
    expect(probe.ingest?.(roundTripped, ctx())).toEqual(probe.ingest?.(report, ctx()));
  });

  test('a report of the wrong schema version is a hard error, not a silent empty run', () => {
    expect(() => probe.ingest?.({ schemaVersion: 99, edges: [] }, ctx())).toThrow(
      'not a graph report of schemaVersion 1',
    );
  });
});

describe('the injected validator path', () => {
  test('a stubbed graph means the probe is testable with no compiler at all', async () => {
    const empty: ModuleGraph = {
      files: [],
      edges: [],
      factsFor: () => undefined,
      walkedCount: 0,
    };
    const findings = await probe.run(ctx({ graph: () => ok(empty) }));
    expect(findings).toEqual([]);
  });
});

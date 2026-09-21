import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGraph } from '../graph/index.js';
import { createGraphProbe } from '../probes/graph.js';
import type { RawFinding, Rule } from '../types.js';
import { canonicalJson, computeIdentity } from './identity.js';
import { normalize } from './normalize.js';

const RULE: Rule = {
  id: 'domain-no-service-import',
  kind: 'layers',
  statement: 'domain may import only contracts and rules',
  severity: 'error',
  confidence: 'deterministic',
  params: { name: 'domain', match: 'modules/*/domain/**', mayImport: ['contracts', 'rules'] },
  remedy: { summary: 'invert the call: the service calls the domain, never the reverse' },
};

const byId = (id: string) => (id === RULE.id ? RULE : undefined);

const finding = (overrides: Partial<RawFinding> = {}): RawFinding => ({
  ruleId: RULE.id,
  file: 'modules/ledger/domain/supersede.ts',
  line: 4,
  evidence: {
    from: 'modules/ledger/domain/supersede.ts',
    to: 'modules/ledger/services/write.ts',
    fromLayer: 'domain',
    toLayer: 'service',
  },
  identity: '',
  ...overrides,
});

describe('canonicalJson', () => {
  test('is key-order independent at every depth', () => {
    const a = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } };
    const b = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  test('drops undefined rather than emitting it', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  test('distinguishes values that differ', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe('the identity hash', () => {
  test('is deterministic for reordered evidence keys', () => {
    const one = computeIdentity('r', { from: 'a.ts', to: 'b.ts', fromLayer: 'x' });
    const two = computeIdentity('r', { fromLayer: 'x', to: 'b.ts', from: 'a.ts' });
    expect(one).toBe(two);
    expect(one).toHaveLength(16);
  });

  test('differs per rule id, so two rules on one edge are two findings', () => {
    expect(computeIdentity('a', { x: 1 })).not.toBe(computeIdentity('b', { x: 1 }));
  });

  test('has no line number in it — that is the whole point', () => {
    const at4 = normalize([{ findings: [finding({ line: 4 })], detectedBy: 'graph' }], { byId });
    const at99 = normalize([{ findings: [finding({ line: 99 })], detectedBy: 'graph' }], { byId });
    expect(at4.ok && at99.ok).toBe(true);
    if (!at4.ok || !at99.ok) return;
    expect(at4.value[0]?.identity).toBe(at99.value[0]?.identity ?? '');
  });
});

describe('identity stability against a real file edit', () => {
  test('shifting the violation down 20 lines leaves the hash unchanged', () => {
    const source = join(import.meta.dir, '..', '..', 'fixtures', 'repos', 'layered');
    const work = mkdtempSync(join(tmpdir(), 'archcheck-shift-'));
    try {
      // A throwaway copy of the fixture, with the violating file pushed down the page.
      cpSync(source, work, { recursive: true });
      rmSync(join(work, '.archcheck'), { recursive: true, force: true });

      const probe = createGraphProbe();
      const rules: Rule[] = [
        { ...RULE, params: { ...RULE.params, catchesUnlayered: true } },
        {
          ...RULE,
          id: 'services-orchestrate-only',
          params: {
            name: 'service',
            match: 'modules/*/services/**',
            mayImport: ['contracts', 'rules', 'domain', 'repository'],
          },
        },
        {
          ...RULE,
          id: 'contracts-import-nothing',
          params: { name: 'contracts', match: 'packages/contracts/**', mayImport: [] },
        },
        {
          ...RULE,
          id: 'rules-are-pure',
          params: { name: 'rules', match: 'modules/*/rules/**', mayImport: ['contracts'] },
        },
        {
          ...RULE,
          id: 'repositories-reach-contracts-only',
          params: {
            name: 'repository',
            match: 'modules/*/repositories/**',
            mayImport: ['contracts'],
          },
        },
      ];
      const lookup = (id: string) => rules.find((r) => r.id === id);
      const ctx = {
        root: work,
        tsconfigPath: join(work, 'tsconfig.json'),
        rules,
        graph: () =>
          readGraph({ root: work, tsconfigPath: join(work, 'tsconfig.json'), cache: false }),
      };

      const before = probe.run(ctx);

      const violating = join(work, 'modules/ledger/domain/supersede.ts');
      const original = readFileSync(violating, 'utf8');
      writeFileSync(violating, `${'\n'.repeat(20)}${original}`);

      const after = probe.run(ctx);

      return Promise.all([before, after]).then(([b, a]) => {
        if (!Array.isArray(b) || !Array.isArray(a)) throw new Error('probe skipped');
        const norm = (findings: RawFinding[]) => {
          const result = normalize([{ findings, detectedBy: 'graph' }], { byId: lookup });
          if (!result.ok) throw new Error(result.error.join('\n'));
          return result.value;
        };
        const b0 = norm(b).find((d) => d.evidence.toLayer === 'service');
        const a0 = norm(a).find((d) => d.evidence.toLayer === 'service');
        expect(b0?.line).toBe(3);
        expect(a0?.line).toBe(23);
        // Position moved by 20 lines; identity did not move at all.
        expect(a0?.identity).toBe(b0?.identity ?? 'differs');
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('enrichment', () => {
  test('a finding becomes a complete Diagnostic', () => {
    const result = normalize([{ findings: [finding()], detectedBy: 'graph' }], { byId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [diagnostic] = result.value;
    expect(diagnostic).toMatchObject({
      ruleId: 'domain-no-service-import',
      schemaVersion: 1,
      statement: RULE.statement,
      severity: 'error',
      confidence: 'deterministic',
      remedy: RULE.remedy,
      detectedBy: ['graph'],
      baselined: false,
    });
    expect(diagnostic?.identity).toHaveLength(16);
    // It only ADDS: the observed fields are untouched.
    expect(diagnostic?.evidence).toEqual(finding().evidence);
    expect(diagnostic?.line).toBe(4);
  });

  test('the baselined flag comes from the injected set', () => {
    const identity = computeIdentity(RULE.id, finding().evidence);
    const result = normalize([{ findings: [finding()], detectedBy: 'graph' }], {
      byId,
      baselined: new Set([identity]),
    });
    if (!result.ok) return;
    expect(result.value[0]?.baselined).toBe(true);
  });
});

describe('deduplication', () => {
  test('two probes observing one violation collapse to one diagnostic', () => {
    const result = normalize(
      [
        { findings: [finding()], detectedBy: 'graph' },
        { findings: [finding({ line: undefined })], detectedBy: 'lint' },
      ],
      { byId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.detectedBy).toEqual(['graph', 'lint']);
    // The more precise position survives the merge.
    expect(result.value[0]?.line).toBe(4);
  });

  test('two different violations of one rule stay two diagnostics', () => {
    const other = finding({
      evidence: { ...finding().evidence, to: 'modules/ledger/services/other.ts' },
    });
    const result = normalize([{ findings: [finding(), other], detectedBy: 'graph' }], { byId });
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  test('a probe-supplied identity is honoured rather than recomputed', () => {
    const result = normalize(
      [{ findings: [finding({ identity: 'preset0000000000' })], detectedBy: 'x' }],
      {
        byId,
      },
    );
    if (!result.ok) return;
    expect(result.value[0]?.identity).toBe('preset0000000000');
  });
});

describe('an unknown ruleId', () => {
  test('is a hard error naming the drift and the fix, never a silent skip', () => {
    const result = normalize(
      [{ findings: [finding({ ruleId: 'ghost-rule' })], detectedBy: 'lint' }],
      {
        byId,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain("lint reported rule 'ghost-rule'");
    expect(result.error[0]).toContain('archcheck emit');
  });
});

describe('ordering', () => {
  test('diagnostics come out sorted, so no reporter has to sort', () => {
    const result = normalize(
      [
        {
          findings: [
            finding({ file: 'z.ts', line: 1, evidence: { k: 'z' } }),
            finding({ file: 'a.ts', line: 9, evidence: { k: 'a9' } }),
            finding({ file: 'a.ts', line: 2, evidence: { k: 'a2' } }),
          ],
          detectedBy: 'graph',
        },
      ],
      { byId },
    );
    if (!result.ok) return;
    expect(result.value.map((d) => `${d.file}:${d.line}`)).toEqual(['a.ts:2', 'a.ts:9', 'z.ts:1']);
  });
});

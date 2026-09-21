import { describe, expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import { buildLayerTable, layersContract, resolveEdge } from './layers.js';

function layerRule(
  id: string,
  name: string,
  mayImport: string[] | '*',
  extra: Record<string, unknown> = {},
): Rule {
  return {
    id,
    kind: 'layers',
    statement: `${name} imports only what it declares`,
    severity: 'error',
    confidence: 'deterministic',
    params: { name, match: `${name}/**`, mayImport, ...extra },
    remedy: { summary: `declare it, or invert the call` },
  };
}

const RULES: Rule[] = [
  layerRule('contracts-import-nothing', 'contracts', []),
  layerRule('rules-are-pure', 'rules', ['contracts']),
  layerRule('domain-no-service-import', 'domain', ['contracts', 'rules'], {
    catchesUnlayered: true,
  }),
  layerRule('services-orchestrate-only', 'service', ['contracts', 'rules', 'domain']),
  layerRule('root-binds-everything', 'root', '*'),
];

const table = buildLayerTable(RULES);
const layer = (name: string) => table.layers.find((l) => l.name === name);
const staticEdge = { external: false, typeOnly: false };

describe('resolution order — every case has a test', () => {
  test('1 · the same layer is allowed', () => {
    expect(resolveEdge(table, layer('domain'), 'domain', staticEdge).allowed).toBe(true);
  });

  test('2 · an external target is allowed — a separate rule governs dependencies', () => {
    const verdict = resolveEdge(table, layer('contracts'), undefined, {
      external: true,
      typeOnly: false,
    });
    expect(verdict.allowed).toBe(true);
  });

  test('3 · a declared mayImport target is allowed', () => {
    expect(resolveEdge(table, layer('domain'), 'rules', staticEdge).allowed).toBe(true);
    expect(resolveEdge(table, layer('service'), 'domain', staticEdge).allowed).toBe(true);
  });

  test('4 · anything else is a violation — DEFAULT DENY', () => {
    const verdict = resolveEdge(table, layer('domain'), 'service', staticEdge);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.ruleId).toBe('domain-no-service-import');
    expect(verdict.fromLayer).toBe('domain');
    expect(verdict.toLayer).toBe('service');
    expect(verdict.mayImport).toEqual(['contracts', 'rules']);
  });

  test('4 · the violation is attributed to the SOURCE layer, which is what must change', () => {
    const verdict = resolveEdge(table, layer('contracts'), 'rules', staticEdge);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.ruleId).toBe('contracts-import-nothing');
  });

  test("mayImport '*' allows everything — the composition root", () => {
    expect(resolveEdge(table, layer('root'), 'repository', staticEdge).allowed).toBe(true);
  });

  test('an unlayered SOURCE produces no edge verdict; its own finding is the report', () => {
    expect(resolveEdge(table, undefined, 'domain', staticEdge).allowed).toBe(true);
  });

  test('an unlayered TARGET is not blamed on the importer', () => {
    expect(resolveEdge(table, layer('domain'), undefined, staticEdge).allowed).toBe(true);
  });

  test('a type-only edge is still a dependency unless the layer says otherwise', () => {
    const typeEdge = { external: false, typeOnly: true };
    expect(resolveEdge(table, layer('domain'), 'service', typeEdge).allowed).toBe(false);

    const lenient = buildLayerTable([
      layerRule('lenient', 'domain', ['contracts'], { ignoreTypeOnly: true }),
    ]);
    const lenientLayer = lenient.layers[0];
    expect(resolveEdge(lenient, lenientLayer, 'service', typeEdge).allowed).toBe(true);
  });
});

describe('the layer table', () => {
  test('is the SET of layers rules — one rule cannot decide default-deny alone', () => {
    expect(table.layers).toHaveLength(5);
    expect(table.unlayeredOwner).toBe('domain-no-service-import');
  });

  test('a rule switched off leaves the table', () => {
    const off = buildLayerTable(RULES.map((r) => ({ ...r, severity: 'off' as const })));
    expect(off.layers).toHaveLength(0);
    expect(off.unlayeredOwner).toBeUndefined();
  });

  test('a single layers rule owns the unlayered report implicitly', () => {
    const one = buildLayerTable([layerRule('only', 'only', [])]);
    expect(one.unlayeredOwner).toBe('only');
  });
});

describe('validate', () => {
  const validate = (rule: Rule, rules: Rule[] = RULES) =>
    layersContract.validate(rule, { rules: [...rules, rule] });

  test('accepts a well-formed layer', () => {
    expect(
      validate(
        RULES[2] as Rule,
        RULES.filter((r) => r.id !== RULES[2]?.id),
      ).ok,
    ).toBe(true);
  });

  test('rejects an unknown layer name in mayImport, and lists the known ones', () => {
    const result = validate(layerRule('bad', 'domain2', ['nonesuch']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain("unknown layer 'nonesuch'");
    expect(result.error[0]).toContain('known layers are');
  });

  test('rejects a missing name and a malformed match together, not one at a time', () => {
    const result = layersContract.validate(
      { ...layerRule('bad', 'x', []), params: { match: 42, mayImport: [] } },
      { rules: RULES },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join('\n')).toContain('params.name is required');
    expect(result.error.join('\n')).toContain('params.match must be a glob');
  });

  test('rejects a layer listing itself', () => {
    const result = validate(layerRule('self', 'domain', ['domain']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join('\n')).toContain('lists its own layer');
  });

  test('rejects a manifest where nobody owns the unlayered report', () => {
    const orphaned = [layerRule('a', 'a', []), layerRule('b', 'b', ['a'])];
    const result = layersContract.validate(orphaned[0] as Rule, { rules: orphaned });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join('\n')).toContain('catchesUnlayered');
  });

  test('rejects two owners of the unlayered report', () => {
    const two = [
      layerRule('a', 'a', [], { catchesUnlayered: true }),
      layerRule('b', 'b', ['a'], { catchesUnlayered: true }),
    ];
    const result = layersContract.validate(two[0] as Rule, { rules: two });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join('\n')).toContain('is set on 2 rules');
  });
});

describe('emit', () => {
  const ctx = { root: '/repo', rules: RULES };

  test('returns fragments for BOTH the graph and lint sinks', () => {
    const fragments = layersContract.emit(RULES[2] as Rule, ctx);
    expect(fragments.map((f) => f.target).sort()).toEqual(['graph', 'lint']);
  });

  test('the lint fragment carries the statement AND the remedy in its message', () => {
    const lint = layersContract.emit(RULES[2] as Rule, ctx).find((f) => f.target === 'lint');
    const content = lint?.content as { message: string; forbiddenLayers: string[] };
    expect(content.message).toBe(
      'domain imports only what it declares — declare it, or invert the call',
    );
    expect(content.forbiddenLayers).toEqual(['root', 'service']);
  });

  test("a '*' layer emits no lint fragment — there is nothing to forbid", () => {
    const fragments = layersContract.emit(RULES[4] as Rule, ctx);
    expect(fragments.map((f) => f.target)).toEqual(['graph']);
  });

  test('an implements-matched layer emits the graph sink only, and does not pretend otherwise', () => {
    const adapters = layerRule('adapters', 'adapters', ['contracts']);
    adapters.params = {
      name: 'adapters',
      match: { implements: 'BlobStore' },
      mayImport: ['contracts'],
    };
    const fragments = layersContract.emit(adapters, { root: '/repo', rules: [...RULES, adapters] });
    expect(fragments.map((f) => f.target)).toEqual(['graph']);
  });
});

describe('explain', () => {
  test('returns the remedy, not the symptom', () => {
    const sentence = layersContract.explain(
      {
        ruleId: 'domain-no-service-import',
        file: 'modules/ledger/domain/supersede.ts',
        line: 4,
        identity: 'abc',
        evidence: {
          from: 'modules/ledger/domain/supersede.ts',
          to: 'modules/ledger/services/write.ts',
          fromLayer: 'domain',
          toLayer: 'service',
          specifier: '../services/write.js',
        },
      },
      RULES[2] as Rule,
      { rules: RULES },
    );
    expect(sentence.split('\n')).toEqual([
      'domain may not import service',
      '  modules/ledger/domain/supersede.ts → modules/ledger/services/write.ts',
      '  domain may import: contracts, rules',
      '  → declare it, or invert the call',
    ]);
  });

  test('an unlayered file gets its OWN distinct message', () => {
    const sentence = layersContract.explain(
      {
        ruleId: 'domain-no-service-import',
        file: 'modules/ledger/undeclared/helper.ts',
        identity: 'def',
        evidence: { unlayered: true, file: 'modules/ledger/undeclared/helper.ts' },
      },
      RULES[2] as Rule,
      { rules: RULES },
    );
    expect(sentence).toContain('belongs to no declared layer');
    expect(sentence).toContain('declared layers: contracts, domain, root, rules, service');
    expect(sentence).not.toContain('may not import');
  });
});

import { describe, expect, test } from 'bun:test';
import type { Diagnostic, RunResult } from '../types.js';
import { reporterFor } from './index.js';
import { SARIF_VERSION, toSarif } from './sarif.js';

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: 'domain-no-service-import',
  file: 'modules/ledger/domain/supersede.ts',
  line: 4,
  col: 1,
  evidence: { fromLayer: 'domain', toLayer: 'service' },
  identity: 'aaaaaaaaaaaaaaaa',
  schemaVersion: 1,
  statement: 'domain may not import services',
  severity: 'error',
  confidence: 'deterministic',
  remedy: { summary: 'invert the call', allowed: ['contracts', 'rules'] },
  detectedBy: ['graph'],
  baselined: false,
  exempted: false,
  ...overrides,
});

const RESULT: RunResult = {
  ok: false,
  diagnostics: [
    diagnostic(),
    diagnostic({
      identity: 'bbbbbbbbbbbbbbbb',
      ruleId: 'controllers-stay-thin',
      statement: 'a controller decides nothing',
      severity: 'error',
      confidence: 'model',
      remedy: { summary: 'move the branch into the domain' },
    }),
    diagnostic({ identity: 'cccccccccccccccc', severity: 'warn' }),
    diagnostic({ identity: 'dddddddddddddddd', baselined: true }),
    diagnostic({ identity: 'eeeeeeeeeeeeeeee', exempted: true }),
  ],
  skipped: [{ probe: 'judgement', reason: 'no credentials' }],
  coverage: { total: 3, deterministic: 2, proxy: 0, model: 1 },
  baselineStale: [],
  exceptions: [],
};

/**
 * ponytail: this checks SARIF 2.1.0's REQUIRED structure and its closed enums, not the whole
 * schema. The ceiling is that a violation in a part of the spec we never emit would pass here.
 * Upgrade path if that ever matters: vendor sarif-schema-2.1.0.json and validate it with ajv as a
 * devDependency — deliberately not done now, because it is 200KB and a dependency to catch a class
 * of mistake we cannot currently make.
 */
function sarifStructureProblems(sarif: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const LEVELS = new Set(['error', 'warning', 'note', 'none']);

  if (sarif.version !== '2.1.0') problems.push('version must be 2.1.0');
  if (typeof sarif.$schema !== 'string') problems.push('$schema is required');

  const runs = sarif.runs as unknown[];
  if (!Array.isArray(runs) || runs.length === 0)
    return [...problems, 'runs must be a non-empty array'];

  for (const run of runs as Record<string, unknown>[]) {
    const driver = (run.tool as { driver?: Record<string, unknown> })?.driver;
    if (typeof driver?.name !== 'string') problems.push('runs[].tool.driver.name is required');

    const declared = new Set(
      ((driver?.rules ?? []) as { id?: string }[]).map((rule) => rule.id ?? ''),
    );

    for (const [index, raw] of ((run.results ?? []) as Record<string, unknown>[]).entries()) {
      const where = `runs[].results[${index}]`;
      if (typeof raw.ruleId !== 'string') problems.push(`${where}.ruleId is required`);
      else if (!declared.has(raw.ruleId))
        problems.push(`${where}.ruleId '${raw.ruleId}' is not in driver.rules`);

      if (typeof (raw.message as { text?: string })?.text !== 'string') {
        problems.push(`${where}.message.text is required`);
      }
      if (raw.level !== undefined && !LEVELS.has(String(raw.level))) {
        problems.push(`${where}.level '${String(raw.level)}' is not a SARIF level`);
      }
      const location = (
        raw.locations as { physicalLocation?: { artifactLocation?: { uri?: string } } }[]
      )?.[0];
      if (typeof location?.physicalLocation?.artifactLocation?.uri !== 'string') {
        problems.push(`${where}.locations[0].physicalLocation.artifactLocation.uri is required`);
      }
    }
  }
  return problems;
}

describe('SARIF structure', () => {
  test('the emitted document has no structural problems', () => {
    expect(sarifStructureProblems(toSarif(RESULT, {}))).toEqual([]);
  });

  test('the validator is not vacuous — it catches a broken document', () => {
    const broken = toSarif(RESULT, {}) as { version: string; runs: Record<string, unknown>[] };
    broken.version = '1.0.0';
    const results = (broken.runs[0]?.results ?? []) as Record<string, unknown>[];
    const first = results[0];
    if (first) first.ruleId = 'a-rule-nobody-declared';
    const problems = sarifStructureProblems(broken);
    expect(problems).toContain('version must be 2.1.0');
    expect(problems.some((p) => p.includes('is not in driver.rules'))).toBe(true);
  });

  test('every result’s ruleId appears in driver.rules', () => {
    const sarif = toSarif(RESULT, {}) as { runs: Record<string, unknown>[] };
    const tool = sarif.runs[0]?.tool as { driver: { rules: { id: string }[] } } | undefined;
    expect(tool?.driver.rules.map((r) => r.id)).toEqual([
      'controllers-stay-thin',
      'domain-no-service-import',
    ]);
  });

  test('version is the one we claim to emit', () => {
    expect((toSarif(RESULT, {}) as { version: string }).version).toBe(SARIF_VERSION);
  });
});

describe('severity mapping is opinionated', () => {
  const levelsByIdentity = () => {
    const sarif = toSarif(RESULT, {}) as { runs: { results: Record<string, unknown>[] }[] };
    return new Map(
      (sarif.runs[0]?.results ?? []).map((r) => [
        (r.properties as { identity: string }).identity,
        r.level,
      ]),
    );
  };

  test('error → error, warn → warning', () => {
    const levels = levelsByIdentity();
    expect(levels.get('aaaaaaaaaaaaaaaa')).toBe('error');
    expect(levels.get('cccccccccccccccc')).toBe('warning');
  });

  test('a MODEL verdict lands as note even when its rule severity says error', () => {
    // The advisory-by-default policy, expressed where CI can see it. A non-deterministic
    // blocking gate is how a check suite loses trust.
    const levels = levelsByIdentity();
    expect(levels.get('bbbbbbbbbbbbbbbb')).toBe('note');
  });
});

describe('our extras survive in properties', () => {
  test('confidence, identity, remedy and evidence are all carried', () => {
    const sarif = toSarif(RESULT, {}) as { runs: { results: Record<string, unknown>[] }[] };
    const first = sarif.runs[0]?.results[0];
    expect(first?.properties).toMatchObject({
      confidence: 'deterministic',
      severity: 'error',
      identity: 'aaaaaaaaaaaaaaaa',
      detectedBy: ['graph'],
      baselined: false,
      exempted: false,
      remedy: { summary: 'invert the call', allowed: ['contracts', 'rules'] },
      evidence: { fromLayer: 'domain', toLayer: 'service' },
    });
  });

  test('the identity hash doubles as a SARIF partial fingerprint, so runs diff cleanly', () => {
    const sarif = toSarif(RESULT, {}) as { runs: { results: Record<string, unknown>[] }[] };
    expect(sarif.runs[0]?.results[0]?.partialFingerprints).toEqual({
      archcheckIdentity: 'aaaaaaaaaaaaaaaa',
    });
  });

  test('run-level state rides on invocations', () => {
    const sarif = toSarif(RESULT, {}) as { runs: { invocations: Record<string, unknown>[] }[] };
    expect(sarif.runs[0]?.invocations[0]).toMatchObject({
      executionSuccessful: false,
      properties: { coverage: RESULT.coverage, skipped: RESULT.skipped },
    });
  });
});

describe('suppressed findings', () => {
  test('are reported as SARIF suppressions rather than silently dropped', () => {
    const sarif = toSarif(RESULT, {}) as { runs: { results: Record<string, unknown>[] }[] };
    const suppressed = (sarif.runs[0]?.results ?? []).filter((r) => r.suppressions !== undefined);
    expect(suppressed).toHaveLength(2);
    const justifications = suppressed.map(
      (r) => (r.suppressions as { justification: string }[])[0]?.justification,
    );
    expect(justifications).toEqual([
      'recorded in .archcheck/baseline.json as pre-existing',
      'covered by a declared exception in architecture.config.ts',
    ]);
  });
});

describe('the reporter', () => {
  test('is registered under "sarif" and emits parseable JSON', async () => {
    const text = (await reporterFor('sarif').report(RESULT, {})) as string;
    expect(JSON.parse(text).version).toBe('2.1.0');
  });
});

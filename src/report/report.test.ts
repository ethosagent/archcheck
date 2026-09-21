import { describe, expect, test } from 'bun:test';
import type { Diagnostic, RunResult } from '../types.js';
import { SCHEMA_VERSION } from '../version.js';
import { reporterFor, reporterNames } from './index.js';
import { toJsonReport } from './json.js';

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    ruleId: 'domain-no-service-import',
    file: 'modules/ledger/domain/supersede.ts',
    line: 4,
    evidence: { fromLayer: 'domain', toLayer: 'service' },
    identity: 'aaaaaaaaaaaaaaaa',
    schemaVersion: SCHEMA_VERSION,
    statement: 'domain may not import services',
    severity: 'error',
    confidence: 'deterministic',
    remedy: {
      summary: 'invert the call: the service calls the domain, never the reverse',
      allowed: ['contracts', 'rules'],
    },
    detectedBy: ['graph'],
    baselined: false,
    exempted: false,
    ...overrides,
  };
}

const FIXED: RunResult = {
  ok: false,
  diagnostics: [
    diagnostic(),
    diagnostic({
      identity: 'bbbbbbbbbbbbbbbb',
      file: 'modules/ledger/domain/other.ts',
      line: 12,
      statement: 'domain may not import services',
      // One identity, three places to fix. The reader is told all three.
      occurrences: 3,
      occurrenceLines: [12, 40, 61],
    }),
    diagnostic({
      identity: 'cccccccccccccccc',
      ruleId: 'controllers-stay-thin',
      file: 'services/api/src/routes/event.ts',
      line: 30,
      statement: 'a controller decides nothing',
      confidence: 'proxy',
      severity: 'warn',
      remedy: { summary: 'move the branch into the domain' },
    }),
    diagnostic({
      identity: 'dddddddddddddddd',
      baselined: true,
      file: 'modules/old/domain/legacy.ts',
    }),
  ],
  skipped: [{ probe: 'judgement', reason: 'no credentials in the environment' }],
  coverage: { total: 5, deterministic: 3, proxy: 1, model: 1, unchecked: 0 },
  baselineStale: [],
  exceptions: [],
};

describe('terminal reporter', () => {
  test('groups by confidence, deterministic first, and shows the remedy', async () => {
    const text = await reporterFor('terminal').report(FIXED, { noColor: true });
    expect(typeof text).toBe('string');
    expect(text).toMatchSnapshot();
  });

  test('a reader can stop after the first group — it is ordered by authority', async () => {
    const text = (await reporterFor('terminal').report(FIXED, { noColor: true })) as string;
    const deterministicAt = text.indexOf('deterministic');
    const proxyAt = text.indexOf('proxy ·');
    const advisoryAt = text.indexOf('advisory');
    expect(deterministicAt).toBeLessThan(proxyAt);
    expect(proxyAt).toBeLessThan(advisoryAt);
  });

  test('baselined findings are counted, not printed, and the flag to see them is named', async () => {
    const text = (await reporterFor('terminal').report(FIXED, { noColor: true })) as string;
    expect(text).not.toContain('modules/old/domain/legacy.ts');
    expect(text).toContain('1 baselined, not shown');
    expect(text).toContain('--show-baselined');
  });

  test('--show-baselined includes them', async () => {
    const text = (await reporterFor('terminal').report(FIXED, {
      noColor: true,
      showBaselined: true,
    })) as string;
    expect(text).toContain('modules/old/domain/legacy.ts');
    expect(text).not.toContain('baselined, not shown');
  });

  test('a collapsed diagnostic says how many occurrences it stands for, and where', async () => {
    const text = (await reporterFor('terminal').report(FIXED, { noColor: true })) as string;
    expect(text).toContain('3 occurrences: lines 12, 40, 61');
    // One extra line, and only where there is more than one occurrence.
    expect(text.split('occurrences')).toHaveLength(2);
  });

  test('a skipped probe is stated, never silently omitted', async () => {
    const text = (await reporterFor('terminal').report(FIXED, { noColor: true })) as string;
    expect(text).toContain('judgement did not run: no credentials in the environment');
  });

  test('a clean run says so', async () => {
    const clean: RunResult = {
      ok: true,
      diagnostics: [],
      skipped: [],
      coverage: { total: 5, deterministic: 5, proxy: 0, model: 0, unchecked: 0 },
      baselineStale: [],
      exceptions: [],
    };
    const text = (await reporterFor('terminal').report(clean, { noColor: true })) as string;
    expect(text).toContain('nothing to fix');
  });

  test('colour is opt-out, and noColor really removes every escape', async () => {
    const plain = (await reporterFor('terminal').report(FIXED, { noColor: true })) as string;
    const coloured = (await reporterFor('terminal').report(FIXED, { noColor: false })) as string;
    expect(plain).not.toContain('\u001B[');
    expect(coloured).toContain('\u001B[');
  });
});

describe('json reporter', () => {
  test('round-trips a RunResult without loss', async () => {
    const text = (await reporterFor('json').report(FIXED, { showBaselined: true })) as string;
    const parsed = JSON.parse(text);
    expect(parsed.diagnostics).toEqual(FIXED.diagnostics);
    expect(parsed.coverage).toEqual(FIXED.coverage);
    expect(parsed.skipped).toEqual(FIXED.skipped);
    expect(parsed.ok).toBe(false);
  });

  test('always carries schemaVersion', async () => {
    const parsed = JSON.parse((await reporterFor('json').report(FIXED, {})) as string);
    expect(parsed.schemaVersion).toBe(1);
  });

  test('skipped is present even when empty — clean must differ from did-not-run', () => {
    const clean: RunResult = {
      ok: true,
      diagnostics: [],
      skipped: [],
      coverage: { total: 0, deterministic: 0, proxy: 0, model: 0, unchecked: 0 },
      baselineStale: [],
      exceptions: [],
    };
    const report = toJsonReport(clean, {});
    expect(Object.keys(report)).toContain('skipped');
    expect(report.skipped).toEqual([]);
  });

  test('is one line by default — it is a wire format', async () => {
    const text = (await reporterFor('json').report(FIXED, {})) as string;
    expect(text.trimEnd().split('\n')).toHaveLength(1);
  });

  test('json-pretty is the human variant, same content', async () => {
    const compact = JSON.parse((await reporterFor('json').report(FIXED, {})) as string);
    const pretty = JSON.parse((await reporterFor('json-pretty').report(FIXED, {})) as string);
    expect(pretty).toEqual(compact);
    expect(
      ((await reporterFor('json-pretty').report(FIXED, {})) as string).split('\n').length,
    ).toBeGreaterThan(5);
  });

  test('baselined findings are excluded by default here too', async () => {
    const parsed = JSON.parse((await reporterFor('json').report(FIXED, {})) as string);
    expect(parsed.diagnostics).toHaveLength(3);
  });
});

describe('the registry', () => {
  test('every declared name resolves to a reporter', () => {
    for (const name of reporterNames()) {
      expect(reporterFor(name).name).toBeTruthy();
    }
  });
});

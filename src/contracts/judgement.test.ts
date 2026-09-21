import { describe, expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import { judgementApplies, judgementContract } from './judgement.js';

const base = (params: Record<string, unknown>, overrides: Partial<Rule> = {}): Rule => ({
  id: 'controllers-stay-thin',
  kind: 'judgement',
  statement: 'a controller decides nothing',
  severity: 'advisory',
  confidence: 'model',
  params,
  remedy: { summary: 'move the decision into the domain' },
  ...overrides,
});

const GOOD = {
  statement: 'A controller must not decide a business outcome.',
  appliesTo: 'src/routes/**',
  examples: { pass: ['return decide(x);'], fail: ['if (a > b) return "no";'] },
  cite: 'the deciding branch',
};

const validate = (params: Record<string, unknown>, overrides: Partial<Rule> = {}) =>
  judgementContract.validate(base(params, overrides), { rules: [] });

describe('validation', () => {
  test('accepts a complete rule', () => {
    expect(validate(GOOD).ok).toBe(true);
  });

  test('a rule without examples.pass fails, and says why it matters', () => {
    const result = validate({ ...GOOD, examples: { fail: GOOD.examples.fail } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('params.examples.pass is required');
    expect(result.error[0]).toContain('flags everything');
  });

  test('a rule without examples.fail fails — nothing would prove it can fire', () => {
    const result = validate({ ...GOOD, examples: { pass: GOOD.examples.pass } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('params.examples.fail is required');
  });

  test('empty example arrays are the same as missing ones', () => {
    expect(validate({ ...GOOD, examples: { pass: [], fail: [] } }).ok).toBe(false);
    expect(validate({ ...GOOD, examples: { pass: ['  '], fail: ['x'] } }).ok).toBe(false);
  });

  test('a rule without cite fails — a verdict with no citation is discarded', () => {
    const result = validate({ ...GOOD, cite: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('params.cite is required');
    expect(result.error[0]).toContain('discarded');
  });

  test('a rule without a statement or appliesTo fails', () => {
    expect(validate({ ...GOOD, statement: '' }).ok).toBe(false);
    expect(validate({ ...GOOD, appliesTo: undefined }).ok).toBe(false);
  });

  test('every problem is reported at once', () => {
    const result = validate({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThanOrEqual(4);
  });
});

describe('severity is policed, not forced', () => {
  test('severity: error LOADS but warns, so promoting one is a visible act', () => {
    const rule = base(GOOD, { severity: 'error' });
    expect(judgementContract.validate(rule, { rules: [rule] }).ok).toBe(true);
    const warnings = judgementContract.warn?.(rule, { rules: [rule] }) ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("severity 'error'");
    expect(warnings[0]).toContain('lose trust');
  });

  test('severity: warn warns too', () => {
    const rule = base(GOOD, { severity: 'warn' });
    expect(judgementContract.warn?.(rule, { rules: [rule] })).toHaveLength(1);
  });

  test('the default advisory is silent', () => {
    const rule = base(GOOD);
    expect(judgementContract.warn?.(rule, { rules: [rule] })).toEqual([]);
  });

  test("a confidence other than 'model' warns that it is ignored", () => {
    const rule = base(GOOD, { confidence: 'deterministic' });
    const warnings = judgementContract.warn?.(rule, { rules: [rule] }) ?? [];
    expect(warnings[0]).toContain("is always 'model'");
  });
});

describe('appliesTo', () => {
  test('is a path glob, with negation', () => {
    expect(judgementApplies({ ...GOOD, appliesTo: 'src/routes/**' }, 'src/routes/a.ts')).toBe(true);
    expect(judgementApplies({ ...GOOD, appliesTo: 'src/routes/**' }, 'src/domain/a.ts')).toBe(
      false,
    );
    expect(
      judgementApplies({ ...GOOD, appliesTo: ['src/**', '!src/legacy/**'] }, 'src/legacy/a.ts'),
    ).toBe(false);
  });
});

describe('emit', () => {
  test('emits the judge’s own inputs, so the prompt is a reviewable committed artefact', () => {
    const fragment = judgementContract.emit(base(GOOD), { root: '/r', rules: [] })[0];
    expect(fragment?.content).toMatchObject({
      judge: true,
      statement: GOOD.statement,
      files: ['src/routes/**'],
      examples: GOOD.examples,
      cite: 'the deciding branch',
    });
  });
});

describe('explain', () => {
  test('quotes the citation and says out loud that a model decided it', () => {
    const sentence = judgementContract.explain(
      {
        ruleId: 'controllers-stay-thin',
        file: 'src/routes/thick.ts',
        line: 4,
        identity: 'x',
        evidence: { cited: 'if (amount > balance * 0.9)', reason: 'it decides eligibility' },
      },
      base(GOOD),
      { rules: [] },
    );
    expect(sentence).toContain('cited: if (amount > balance * 0.9)');
    expect(sentence).toContain('the judge said: it decides eligibility');
    expect(sentence).toContain('a model decided this');
  });
});

import { describe, expect, test } from 'bun:test';
import type { Diagnostic, Rule } from '../types.js';
import {
  type ArchitectureException,
  applyExceptions,
  todayIso,
  validateExceptions,
} from './index.js';

const RULE: Rule = {
  id: 'no-deep-module-imports',
  kind: 'encapsulation',
  statement: 'a module is reached through its barrel',
  severity: 'error',
  confidence: 'deterministic',
  params: { module: 'modules/*', publicSurface: 'index.ts' },
  remedy: { summary: 'import the barrel' },
};

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: 'no-deep-module-imports',
  file: 'modules/graph/build.ts',
  evidence: {},
  identity: 'aaaaaaaaaaaaaaaa',
  schemaVersion: 1,
  statement: 'a module is reached through its barrel',
  severity: 'error',
  confidence: 'deterministic',
  remedy: { summary: 'import the barrel' },
  detectedBy: ['graph'],
  baselined: false,
  exempted: false,
  ...overrides,
});

const exception = (overrides: Partial<ArchitectureException> = {}): ArchitectureException => ({
  rule: 'no-deep-module-imports',
  path: 'modules/graph/**',
  owner: 'mitesh',
  expires: '2026-12-31',
  reason: 'legacy module, scheduled for removal in Q4',
  ...overrides,
});

describe('suppression', () => {
  test('an exception marks its violation exempted rather than deleting it', () => {
    const { diagnostics } = applyExceptions([exception()], [diagnostic()], '2026-09-21');
    expect(diagnostics[0]?.exempted).toBe(true);
    // Still present: suppressed is not the same as unobserved.
    expect(diagnostics).toHaveLength(1);
  });

  test('it does not touch a different rule’s finding', () => {
    const other = diagnostic({ ruleId: 'some-other-rule' });
    expect(applyExceptions([exception()], [other], '2026-09-21').diagnostics[0]?.exempted).toBe(
      false,
    );
  });

  test('it does not touch a file outside its path', () => {
    const elsewhere = diagnostic({ file: 'modules/ledger/x.ts' });
    expect(applyExceptions([exception()], [elsewhere], '2026-09-21').diagnostics[0]?.exempted).toBe(
      false,
    );
  });

  test('an identity-pinned exception covers exactly one finding', () => {
    const pinned = exception({ path: undefined, identity: 'aaaaaaaaaaaaaaaa' });
    expect(applyExceptions([pinned], [diagnostic()], '2026-09-21').diagnostics[0]?.exempted).toBe(
      true,
    );
    const different = diagnostic({ identity: 'bbbbbbbbbbbbbbbb' });
    expect(applyExceptions([pinned], [different], '2026-09-21').diagnostics[0]?.exempted).toBe(
      false,
    );
  });
});

describe('the expiry boundary', () => {
  const cases: [string, boolean, boolean][] = [
    // today, suppresses?, expired?
    ['2026-12-30', true, false],
    ['2026-12-31', true, false],
    ['2027-01-01', false, true],
  ];

  for (const [today, suppresses, expired] of cases) {
    test(`on ${today}: suppresses=${suppresses}, expired=${expired}`, () => {
      const applied = applyExceptions([exception()], [diagnostic()], today);
      expect(applied.diagnostics[0]?.exempted).toBe(suppresses);
      expect(applied.statuses[0]?.expired).toBe(expired);
    });
  }

  test('the expiry date itself is the last day it holds', () => {
    expect(applyExceptions([exception()], [diagnostic()], '2026-12-31').expired).toEqual([]);
    expect(applyExceptions([exception()], [diagnostic()], '2027-01-01').expired).toHaveLength(1);
  });

  test('daysLeft counts down and goes negative once past', () => {
    expect(applyExceptions([exception()], [], '2026-12-01').statuses[0]?.daysLeft).toBe(30);
    expect(applyExceptions([exception()], [], '2027-01-10').statuses[0]?.daysLeft).toBe(-10);
  });

  test('suppression and expiry are one mechanism, so they never disagree', () => {
    // Suppression once compared the strings while expiry parsed the dates, and a February 30th
    // made the two answer differently. One decision function now feeds both.
    for (const today of ['2026-12-30', '2026-12-31', '2027-01-01', '2027-03-01']) {
      const applied = applyExceptions([exception()], [diagnostic()], today);
      expect(applied.diagnostics[0]?.exempted).toBe(!applied.statuses[0]?.expired);
      expect(Number.isNaN(applied.statuses[0]?.daysLeft)).toBe(false);
    }
  });
});

describe('always visible', () => {
  test('an exception suppressing nothing is still reported, with suppressed: 0', () => {
    const statuses = applyExceptions([exception()], [], '2026-09-21').statuses;
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.suppressed).toBe(0);
  });

  test('each status carries the path it covers, exactly as the manifest wrote it', () => {
    // Without it a consumer of `--format json` cannot tell which file an exception covers short of
    // parsing the prose reason.
    const statuses = applyExceptions(
      [
        exception(),
        exception({ path: ['modules/a/**', 'modules/b.ts'] }),
        exception({ path: undefined, identity: 'aaaaaaaaaaaaaaaa' }),
      ],
      [],
      '2026-09-21',
    ).statuses;
    expect(statuses[0]?.path).toBe('modules/graph/**');
    expect(statuses[1]?.path).toEqual(['modules/a/**', 'modules/b.ts']);
    // An identity-pinned exception has no path, and the key is absent rather than invented.
    expect(statuses[2] !== undefined && 'path' in statuses[2]).toBe(false);
  });

  test('the suppressed count is real', () => {
    const two = [diagnostic(), diagnostic({ identity: 'bbbbbbbbbbbbbbbb' })];
    expect(applyExceptions([exception()], two, '2026-09-21').statuses[0]?.suppressed).toBe(2);
  });
});

describe('validation', () => {
  const check = (overrides: Partial<ArchitectureException>) =>
    validateExceptions([{ ...exception(), ...overrides }], [RULE]);

  test('accepts a complete exception', () => {
    expect(check({}).ok).toBe(true);
  });

  test('rejects a missing owner — an unowned allowance is never re-justified', () => {
    const result = check({ owner: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('owner is required');
  });

  test('rejects a missing or malformed expiry', () => {
    expect(check({ expires: '' }).ok).toBe(false);
    expect(check({ expires: 'next year' }).ok).toBe(false);
  });

  test('rejects an expiry that is regex-shaped but not a real calendar date', () => {
    // `9999-99-99` passes the shape check, so it used to suppress forever and report NaN days
    // left. A calendar-invalid date is a manifest error — exit 2.
    for (const expires of ['9999-99-99', '2030-02-30', '2026-02-29', '2026-13-01', '2026-04-00']) {
      const result = check({ expires });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]).toContain('not a real calendar date');
    }
  });

  test('accepts a real leap day', () => {
    expect(check({ expires: '2028-02-29' }).ok).toBe(true);
  });

  test('rejects a missing reason — the next reader has to be able to judge it', () => {
    const result = check({ reason: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('reason is required');
  });

  test('rejects an exception with neither path nor identity', () => {
    const result = check({ path: undefined, identity: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('cannot cover everything');
  });

  test('rejects an exception for a rule the manifest does not define', () => {
    const result = check({ rule: 'no-such-rule' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]).toContain('is not defined in the manifest');
  });

  test('reports every problem at once, not the first', () => {
    const result = validateExceptions(
      [{ rule: 'nope', owner: '', expires: 'soon', reason: '' } as ArchitectureException],
      [RULE],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThanOrEqual(5);
  });
});

describe('todayIso', () => {
  test('is an ISO date', () => {
    expect(todayIso(new Date('2026-09-21T13:45:00Z'))).toBe('2026-09-21');
  });
});

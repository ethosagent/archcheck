import { describe, expect, test } from 'bun:test';
import { type AuditPolicy, dependencyNamesOf, unapprovedDependencies } from './dependencyAudit.js';

describe('dependencyNamesOf', () => {
  test('it reads the names it was asked for, sorted and once each', () => {
    const cases: [string, Parameters<typeof dependencyNamesOf>[0], boolean, string[]][] = [
      ['sorted', { dependencies: { zod: '^3', typescript: '^5' } }, false, ['typescript', 'zod']],
      [
        'dev left out',
        { dependencies: { zod: '^3' }, devDependencies: { bun: '^1' } },
        false,
        ['zod'],
      ],
      [
        'dev asked for',
        { dependencies: { zod: '^3' }, devDependencies: { bun: '^1' } },
        true,
        ['bun', 'zod'],
      ],
      ['once each', { dependencies: { zod: '^3' }, devDependencies: { zod: '^3' } }, true, ['zod']],
    ];

    for (const [, pkg, dev, expected] of cases) {
      expect(dependencyNamesOf(pkg, dev)).toEqual(expected);
    }
  });

  test('a malformed package.json is an empty list, never a throw', () => {
    const malformed: Parameters<typeof dependencyNamesOf>[0][] = [
      {},
      { dependencies: null },
      { dependencies: 'zod' },
      { dependencies: ['zod'] },
      { dependencies: 7 },
    ];

    for (const pkg of malformed) {
      expect(dependencyNamesOf(pkg, false)).toEqual([]);
    }
  });
});

describe('unapprovedDependencies', () => {
  const policy: AuditPolicy = { allowed: ['zod'], unassigned: ['bun-types'] };

  test('a name no layer allows and nobody placed is reported', () => {
    expect(unapprovedDependencies(['zod', 'bun-types', 'lodash'], policy)).toEqual(['lodash']);
    expect(unapprovedDependencies(['lodash', 'left-pad'], policy)).toEqual(['lodash', 'left-pad']);
    expect(unapprovedDependencies([], policy)).toEqual([]);
  });

  test('an empty allow list approves nothing', () => {
    const emptyPolicy = { allowed: [], unassigned: [] };
    expect(unapprovedDependencies(['zod'], emptyPolicy)).toEqual(['zod']);
  });

  test('a scoped name is one name, never a prefix', () => {
    // A prefix match would approve every package in the scope.
    const scopedPolicy = { allowed: ['@scope'], unassigned: [] };
    expect(unapprovedDependencies(['@scope/thing'], scopedPolicy)).toEqual(['@scope/thing']);
  });
});

import { describe, expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import {
  type EncapsulationParams,
  encapsulationContract,
  moduleOf,
  resolveEncapsulation,
} from './encapsulation.js';

const PARAMS: EncapsulationParams = { module: 'modules/*', publicSurface: 'index.ts' };

const RULE: Rule = {
  id: 'no-deep-module-imports',
  kind: 'encapsulation',
  statement: 'a module is reached through its barrel',
  severity: 'error',
  confidence: 'deterministic',
  params: PARAMS as unknown as Record<string, unknown>,
  remedy: { summary: 'import the module barrel' },
};

describe('moduleOf', () => {
  test('claims the module root for every file beneath it', () => {
    expect(moduleOf('modules/*', 'modules/ledger/services/write.ts')).toBe('modules/ledger');
    expect(moduleOf('modules/*', 'modules/ledger/index.ts')).toBe('modules/ledger');
  });

  test('returns undefined for a path in no module', () => {
    expect(moduleOf('modules/*', 'packages/contracts/src/a.ts')).toBeUndefined();
    expect(moduleOf('modules/*', 'modules/loose.ts')).toBeUndefined();
  });
});

describe('resolveEncapsulation', () => {
  test('a cross-module deep import is a violation, and names the module and the path', () => {
    const verdict = resolveEncapsulation(
      PARAMS,
      'modules/graph/build.ts',
      'modules/ledger/domain/supersede.ts',
    );
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.module).toBe('modules/ledger');
    expect(verdict.deepPath).toBe('domain/supersede.ts');
    expect(verdict.surfaces).toEqual(['index.ts']);
  });

  test('a SAME-module deep import is not a violation — this is the case that gets it wrong', () => {
    const verdict = resolveEncapsulation(
      PARAMS,
      'modules/ledger/services/write.ts',
      'modules/ledger/domain/supersede.ts',
    );
    expect(verdict.allowed).toBe(true);
  });

  test('the barrel itself is always allowed', () => {
    expect(
      resolveEncapsulation(PARAMS, 'modules/graph/build.ts', 'modules/ledger/index.ts').allowed,
    ).toBe(true);
  });

  test('a target in no module is not this rule’s business', () => {
    expect(
      resolveEncapsulation(PARAMS, 'modules/graph/build.ts', 'packages/contracts/src/a.ts').allowed,
    ).toBe(true);
  });

  test('several public surfaces are all honoured', () => {
    const wide: EncapsulationParams = {
      module: 'modules/*',
      publicSurface: ['index.ts', 'types.ts'],
    };
    expect(resolveEncapsulation(wide, 'modules/a/x.ts', 'modules/b/types.ts').allowed).toBe(true);
    expect(resolveEncapsulation(wide, 'modules/a/x.ts', 'modules/b/errors.ts').allowed).toBe(false);
  });
});

describe('validate', () => {
  test('requires module and publicSurface', () => {
    const result = encapsulationContract.validate({ ...RULE, params: {} }, { rules: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.join('\n')).toContain('params.module is required');
    expect(result.error.join('\n')).toContain('params.publicSurface is required');
  });

  test('rejects a publicSurface that is not relative to the module root', () => {
    const result = encapsulationContract.validate(
      { ...RULE, params: { module: 'modules/*', publicSurface: './index.ts' } },
      { rules: [] },
    );
    expect(result.ok).toBe(false);
  });

  test('accepts the well-formed rule', () => {
    expect(encapsulationContract.validate(RULE, { rules: [RULE] }).ok).toBe(true);
  });
});

describe('emit — two sinks, one rule', () => {
  test('returns a graph fragment AND an exports fragment', () => {
    const fragments = encapsulationContract.emit(RULE, { root: '/repo', rules: [RULE] });
    expect(fragments.map((f) => f.target).sort()).toEqual(['exports', 'graph']);
  });

  test('the emitted exports map lists only public surfaces', () => {
    const exportsFragment = encapsulationContract
      .emit(
        { ...RULE, params: { module: 'modules/*', publicSurface: ['index.ts', 'types.ts'] } },
        {
          root: '/repo',
          rules: [RULE],
        },
      )
      .find((f) => f.target === 'exports');
    expect(exportsFragment?.content).toEqual({
      module: 'modules/*',
      exports: { '.': './index.js', './types': './types.js' },
    });
  });
});

describe('explain', () => {
  test('names the public surface and the remedy', () => {
    const sentence = encapsulationContract.explain(
      {
        ruleId: RULE.id,
        file: 'modules/graph/build.ts',
        identity: 'x',
        evidence: { module: 'modules/ledger', to: 'modules/ledger/domain/supersede.ts' },
      },
      RULE,
      { rules: [RULE] },
    );
    expect(sentence).toContain('modules/ledger is reached through its public surface only');
    expect(sentence).toContain('public surface: index.ts');
    expect(sentence).toContain('→ import the module barrel');
  });
});

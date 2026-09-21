import { describe, expect, test } from 'bun:test';
import { CONTRACT_KINDS, type Diagnostic } from './types.js';
import { SCHEMA_VERSION } from './version.js';

describe('core types', () => {
  test('the contract kind set is closed at eight', () => {
    expect(CONTRACT_KINDS).toHaveLength(8);
    expect(new Set(CONTRACT_KINDS).size).toBe(8);
  });

  test('a Diagnostic cannot be built without statement, confidence and remedy', () => {
    // Type-level: each line below is a compile error, asserted by the // @ts-expect-error above
    // it. If the field ever becomes optional the directive goes unused and tsc fails.
    // @ts-expect-error missing statement, confidence, remedy
    const missing: Diagnostic = {
      ruleId: 'r',
      file: 'a.ts',
      evidence: {},
      identity: 'x',
      schemaVersion: SCHEMA_VERSION,
      severity: 'error',
      detectedBy: ['graph'],
      baselined: false,
    };
    expect(missing.ruleId).toBe('r');

    const complete: Diagnostic = {
      ruleId: 'r',
      file: 'a.ts',
      evidence: {},
      identity: 'x',
      schemaVersion: SCHEMA_VERSION,
      statement: 's',
      severity: 'error',
      confidence: 'deterministic',
      remedy: { summary: 'do the thing' },
      detectedBy: ['graph'],
      baselined: false,
    };
    expect(complete.schemaVersion).toBe(1);
  });
});

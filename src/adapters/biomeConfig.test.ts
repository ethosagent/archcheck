import { describe, expect, test } from 'bun:test';
import { type SinkEntry, toBiomeConfig } from './biomeConfig.js';

const IMPORTS: SinkEntry = {
  ruleId: 'the-domain-decides',
  files: ['src/domain/**'],
  forbid: 'import-path-matching',
  message: 'the domain decides, and never calls a service',
  patterns: ['src/service/**'],
};

const CONSOLE: SinkEntry = {
  ruleId: 'no-console',
  files: ['src/**'],
  forbid: 'member-access',
  message: 'a library writes to no stream',
  target: 'console',
};

describe('what Biome can say', () => {
  test("an import ban carries its patterns and the rule's own sentence", () => {
    const [override] = toBiomeConfig([IMPORTS]).overrides;
    expect(override?.includes).toEqual(['src/domain/**']);
    const rule = override?.linter.rules.style.noRestrictedImports;
    expect(rule).toEqual({
      level: 'error',
      options: { patterns: [{ group: ['src/service/**'], message: IMPORTS.message }] },
    });
  });

  test('a bare member-access ban becomes a denied global', () => {
    const [override] = toBiomeConfig([CONSOLE]).overrides;
    expect(override?.linter.rules.style.noRestrictedGlobals).toEqual({
      level: 'error',
      options: { deniedGlobals: { console: CONSOLE.message } },
    });
    expect(toBiomeConfig([CONSOLE]).unexpressed).toEqual([]);
  });
});

describe('what Biome cannot say comes back by rule id', () => {
  test('each entry Biome has no rule for is named, not dropped', () => {
    const refused: [string, SinkEntry][] = [
      // A dotted target needs a nursery rule, and this generated file is committed.
      ['a dotted target', { ...CONSOLE, target: 'console.log' }],
      ['an empty target', { ...CONSOLE, target: '' }],
      // noEmptyBlockStatements has no catch scope, so it would be louder than the gate.
      ['empty-catch, which ESLint does express', { ...CONSOLE, forbid: 'empty-catch' }],
      ['computed-dynamic-import', { ...CONSOLE, forbid: 'computed-dynamic-import' }],
      ['suppression-comment', { ...CONSOLE, forbid: 'suppression-comment' }],
      ['name-not-matching', { ...CONSOLE, forbid: 'name-not-matching' }],
    ];

    for (const [, entry] of refused) {
      expect(toBiomeConfig([entry]).overrides).toEqual([]);
      expect(toBiomeConfig([entry]).unexpressed).toEqual(['no-console']);
    }
  });

  test('a rule is named once, and an empty sink says nothing', () => {
    const emptyPatterns = toBiomeConfig([{ ...IMPORTS, patterns: [] }]);
    expect(emptyPatterns.overrides).toEqual([]);
    expect(emptyPatterns.unexpressed).toEqual(['the-domain-decides']);

    const repeats: SinkEntry[] = [
      CONSOLE,
      { ...CONSOLE, forbid: 'empty-catch' },
      { ...CONSOLE, target: '' },
    ];

    expect(toBiomeConfig(repeats).unexpressed).toEqual(['no-console']);

    expect(toBiomeConfig([])).toEqual({ overrides: [], unexpressed: [] });
  });
});

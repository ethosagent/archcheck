import { describe, expect, test } from 'bun:test';
import type { Coverage, Rule } from '../types.js';
import {
  automatablePercent,
  FENCE_BEGIN,
  FENCE_END,
  renderRulesTable,
  replaceFencedRegion,
  rulesDocument,
} from './index.js';

const rule = (
  id: string,
  confidence: Rule['confidence'],
  severity: Rule['severity'] = 'error',
): Rule => ({
  id,
  kind: 'layers',
  statement: `${id} holds`,
  severity,
  confidence,
  params: {},
  remedy: { summary: 'fix it' },
});

const coverageOf = (rules: Rule[]): Coverage => {
  const active = rules.filter((r) => r.severity !== 'off');
  return {
    total: active.length,
    deterministic: active.filter((r) => r.confidence === 'deterministic').length,
    proxy: active.filter((r) => r.confidence === 'proxy').length,
    model: active.filter((r) => r.confidence === 'model').length,
  };
};

describe('coverage cannot be claimed', () => {
  test('the percentage is deterministic + proxy over the total', () => {
    expect(automatablePercent({ total: 4, deterministic: 2, proxy: 1, model: 1 })).toBe(75);
  });

  test('an empty manifest is 0%, not a division by zero', () => {
    expect(automatablePercent({ total: 0, deterministic: 0, proxy: 0, model: 0 })).toBe(0);
  });

  test('adding a JUDGEMENT rule moves the percentage DOWN', () => {
    const before = [rule('a', 'deterministic'), rule('b', 'deterministic')];
    const after = [...before, rule('c', 'model')];
    expect(automatablePercent(coverageOf(before))).toBe(100);
    expect(automatablePercent(coverageOf(after))).toBe(67);
  });

  test('adding a deterministic rule does not move it down', () => {
    const rules = [
      rule('a', 'deterministic'),
      rule('b', 'deterministic'),
      rule('c', 'deterministic'),
    ];
    expect(automatablePercent(coverageOf(rules))).toBe(100);
  });
});

describe('rules.json', () => {
  test('is data, sorted by id, with the mark for each tier', () => {
    const rules = [rule('zulu', 'model'), rule('alpha', 'deterministic'), rule('mike', 'proxy')];
    const document = rulesDocument(rules, coverageOf(rules));
    expect(document.schemaVersion).toBe(1);
    expect(document.rules.map((r) => r.id)).toEqual(['alpha', 'mike', 'zulu']);
    expect(document.rules.map((r) => r.mark)).toEqual(['✓', '◑', '○']);
  });

  test('excludes rules switched off', () => {
    const rules = [rule('on', 'deterministic'), rule('off', 'deterministic', 'off')];
    expect(rulesDocument(rules, coverageOf(rules)).rules.map((r) => r.id)).toEqual(['on']);
  });

  test('carries the computed percentage alongside the counts', () => {
    const rules = [rule('a', 'deterministic'), rule('b', 'model')];
    expect(rulesDocument(rules, coverageOf(rules)).coverage).toEqual({
      total: 2,
      deterministic: 1,
      proxy: 0,
      model: 1,
      automatable: 50,
    });
  });
});

describe('the fenced region', () => {
  const document = rulesDocument(
    [rule('a', 'deterministic')],
    coverageOf([rule('a', 'deterministic')]),
  );
  const table = renderRulesTable(document);

  test('renders between the fences, with the counts and one row per rule', () => {
    expect(table.startsWith(FENCE_BEGIN)).toBe(true);
    expect(table.endsWith(FENCE_END)).toBe(true);
    expect(table).toContain('**1 rules**');
    expect(table).toContain('| ✓ | `a` |');
  });

  test('a pipe in a statement is escaped, so it cannot break the table', () => {
    const piped = rule('p', 'deterministic');
    piped.statement = 'a | b';
    const rendered = renderRulesTable(rulesDocument([piped], coverageOf([piped])));
    expect(rendered).toContain('a \\| b');
  });

  test('replacement is idempotent — two emits produce identical output', () => {
    const source = `# Doc\n\nprose\n\n${FENCE_BEGIN}\n${FENCE_END}\n\nmore prose\n`;
    const once = replaceFencedRegion(source, table);
    expect(once).toBeDefined();
    const twice = replaceFencedRegion(once as string, table);
    expect(twice).toBe(once as string);
  });

  test('prose outside the fence is untouched', () => {
    // A distinctive marker: 'old' would have matched the substring in 'a holds'.
    const source = `# Doc\n\nkeep me\n\n${FENCE_BEGIN}\nPREVIOUSLY_GENERATED\n${FENCE_END}\n\nkeep me too\n`;
    const replaced = replaceFencedRegion(source, table) as string;
    expect(replaced).toContain('keep me');
    expect(replaced).toContain('keep me too');
    expect(replaced).not.toContain('PREVIOUSLY_GENERATED');
  });

  test('a document with no fence is left alone rather than growing one', () => {
    expect(replaceFencedRegion('# Doc\n\nno fence here\n', table)).toBeUndefined();
  });

  test('a half-open fence is not a fence', () => {
    expect(replaceFencedRegion(`# Doc\n${FENCE_BEGIN}\n`, table)).toBeUndefined();
    expect(replaceFencedRegion(`# Doc\n${FENCE_END}\n${FENCE_BEGIN}\n`, table)).toBeUndefined();
  });
});

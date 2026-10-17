import { expect, test } from 'bun:test';
import { type SinkEntry, toEslintConfig } from './eslintConfig.js';

function entry(over: Partial<SinkEntry>): SinkEntry {
  return { ruleId: 'r', files: ['src/**'], forbid: 'x', message: 'say it', ...over };
}

test('an import entry becomes no-restricted-imports, with its patterns and message', () => {
  const imports = entry({ forbid: 'import-path-matching', patterns: ['src/a/**'] });
  const adapted = toEslintConfig([imports]);

  expect(adapted.blocks).toHaveLength(1);
  expect(adapted.blocks[0]?.files).toEqual(['src/**']);
  expect(adapted.blocks[0]?.rules['no-restricted-imports']).toEqual([
    'error',
    { patterns: [{ group: ['src/a/**'], message: 'say it' }] },
  ]);
});

test('each syntax kind becomes the rule named for it', () => {
  const member = toEslintConfig([entry({ forbid: 'member-access', target: 'console.log' })]);
  const bare = toEslintConfig([entry({ forbid: 'member-access', target: 'console' })]);
  const empty = toEslintConfig([entry({ forbid: 'empty-catch' })]);
  const dynamic = toEslintConfig([entry({ forbid: 'computed-dynamic-import' })]);

  expect(member.blocks[0]?.rules['no-restricted-syntax']).toBeDefined();
  expect(empty.blocks[0]?.rules['no-empty']).toEqual(['error', { allowEmptyCatch: false }]);
  expect(dynamic.blocks[0]?.rules['no-restricted-syntax']).toBeDefined();
  expect(bare.blocks[0]?.rules['no-restricted-syntax']).toBeDefined();
});

test('what ESLint cannot express comes back by rule id, sorted and unique', () => {
  const cannot = toEslintConfig([
    entry({ ruleId: 'b', forbid: 'suppression-comment' }),
    entry({ ruleId: 'a', forbid: 'name-not-matching' }),
    entry({ ruleId: 'a', forbid: 'name-not-matching' }),
    entry({ ruleId: 'c', forbid: 'member-access', target: '' }),
  ]);

  expect(cannot.blocks).toHaveLength(0);
  expect(cannot.unexpressed).toEqual(['a', 'b', 'c']);
});

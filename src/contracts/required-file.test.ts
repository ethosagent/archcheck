import { expect, test } from 'bun:test';
import type { Rule } from '../types.js';
import { requiredFileContract, subjectsFor } from './required-file.js';

function fileRule(id: string, params: Record<string, unknown>): Rule {
  return {
    id,
    kind: 'required-file',
    statement: 'a companion file exists',
    severity: 'error',
    confidence: 'deterministic',
    params,
    remedy: { summary: 'write it' },
  };
}

const validate = (rule: Rule) => requiredFileContract.validate(rule, { rules: [rule] });

test('a dir selector yields one subject per directory, not one per file', () => {
  const files = ['packages/ui/a.ts', 'packages/ui/b.ts', 'packages/api/c.ts'];
  const params = { forEach: 'dir[packages/*]', expect: '{dir}/README.md' };
  const subjects = subjectsFor(params, { rules: [], files });

  expect(subjects).toHaveLength(2);
  expect(subjects[0]?.subject).toBe('packages/api');
  expect(subjects[0]?.expected).toBe('packages/api/README.md');
  expect(subjects[1]?.subject).toBe('packages/ui');
  expect(subjects[1]?.expected).toBe('packages/ui/README.md');
});

test('mustNotExist makes a matched path its own expectation', () => {
  const params = { forEach: 'src/**/*.js', mustNotExist: true };
  const subjects = subjectsFor(params, { rules: [], files: ['src/legacy.js'] });

  expect(subjects).toHaveLength(1);
  expect(subjects[0]?.expected).toBe('src/legacy.js');
});

test('validation names the placeholder form a rule is in', () => {
  const wrongForm = fileRule('a', { forEach: 'packages/**/*.ts', expect: '{dirname}/x.ts' });
  const ruleSelector = fileRule('b', { forEach: 'rule[severity=error]', mustNotExist: true });
  const first = validate(wrongForm);
  const second = validate(ruleSelector);

  expect(first.ok).toBe(false);
  if (first.ok) return;
  expect(first.error.join(' ')).toContain('only a directory-iterating rule');

  expect(second.ok).toBe(false);
  if (second.ok) return;
  expect(second.error.join(' ')).toContain('cannot iterate rules');
});

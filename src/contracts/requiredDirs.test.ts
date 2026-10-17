import { expect, test } from 'bun:test';
import { dirGlobOf, dirsOf, expandForDir, isDirSelector } from './requiredDirs.js';

test('a dir selector is recognised, and its glob is read out', () => {
  expect(isDirSelector('dir[packages/*]')).toBe(true);
  expect(isDirSelector('src/**/*.ts')).toBe(false);
  expect(dirGlobOf('dir[packages/*]')).toBe('packages/*');
  expect(dirGlobOf('src/**')).toBeUndefined();
  expect(isDirSelector('a dir[packages/*] mention inside a sentence')).toBe(false);
});

test('dirsOf returns one sorted entry per directory, and ignores files outside the glob', () => {
  const files = ['packages/ui/a.ts', 'packages/ui/b.ts', 'packages/api/c.ts'];
  expect(dirsOf('packages/*', files)).toEqual(['packages/api', 'packages/ui']);
  expect(dirsOf('packages/*', ['src/other/a.ts'])).toEqual([]);
});

test('each of the three placeholders expands', () => {
  expect(expandForDir('{dir}/README.md', 'packages/ui')).toBe('packages/ui/README.md');
  expect(expandForDir('{parent}/{dirname}.md', 'packages/ui')).toBe('packages/ui.md');
  expect(expandForDir('{parent}|{dirname}', 'packages')).toBe('|packages');
});

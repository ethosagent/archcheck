import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { missingCompilerApi } from './compilerApi.js';

describe('the compiler-API guard', () => {
  test('the installed typescript passes', () => {
    expect(missingCompilerApi(ts)).toBeUndefined();
  });

  test('TypeScript 7’s root entry is rejected, with the version and the fix', () => {
    // What `import ts from 'typescript'` actually gives on typescript@7: the native port's root
    // entry exports only the version. This exact shape produced
    // "Cannot read properties of undefined (reading 'readFile')" in a real consumer install.
    const typescript7Root = { version: '7.0.2', versionMajorMinor: '7.0' };
    const problems = missingCompilerApi(typescript7Root);
    expect(problems).toBeDefined();
    expect(problems?.[0]).toContain('(7.0.2)');
    expect(problems?.join('\n')).toContain('sys, createProgram, transpileModule, readConfigFile');
    expect(problems?.join('\n')).toContain('typescript@^5.9');
  });

  test('a missing typescript altogether is reported, not thrown', () => {
    expect(missingCompilerApi(undefined)).toBeDefined();
    expect(missingCompilerApi(null)).toBeDefined();
  });

  test('a partial API is reported with exactly what is absent', () => {
    const partial = { version: '5.9.3', sys: {}, transpileModule: () => undefined };
    expect(missingCompilerApi(partial)?.join('\n')).toContain(
      'missing: createProgram, readConfigFile',
    );
  });
});

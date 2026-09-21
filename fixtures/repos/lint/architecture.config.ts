import { defineArchitecture } from 'archcheck';

const syntax = {
  kind: 'banned-syntax' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    {
      ...syntax,
      id: 'no-clock-in-a-rule',
      statement: 'a rule is pure: it reads no clock',
      params: { appliesTo: 'src/rules/**', selector: 'member-access', target: 'Date.now' },
      remedy: { summary: 'take the timestamp as an argument from the caller' },
    },
    {
      ...syntax,
      id: 'no-date-construction-in-a-rule',
      statement: 'a rule is pure: it constructs no clock',
      params: { appliesTo: 'src/rules/**', selector: 'new-expression', target: 'Date' },
      remedy: { summary: 'take the timestamp as an argument from the caller' },
    },
    {
      ...syntax,
      id: 'no-computed-dynamic-import',
      statement: 'a dynamic import names its module literally',
      params: { appliesTo: 'src/**', selector: 'computed-dynamic-import' },
      remedy: { summary: 'import the candidates statically and pick between them' },
    },
    {
      ...syntax,
      id: 'no-console-outside-an-entry-point',
      statement: 'logging goes through one seam, never straight to the console',
      params: { appliesTo: ['src/**', '!src/entry/**'], selector: 'member-access', target: 'console' },
      remedy: { summary: 'inject a logger, or move this to an entry point' },
    },
    {
      ...syntax,
      id: 'no-inline-suppression',
      statement: 'an exception lives in the manifest with an owner and an expiry, never inline',
      params: { appliesTo: 'src/**', selector: 'suppression-comment' },
      remedy: { summary: 'add an exception to architecture.config.ts, with an owner and an expiry' },
    },
    {
      ...syntax,
      id: 'no-empty-catch',
      statement: 'a caught error is handled or rethrown, never swallowed',
      params: { appliesTo: 'src/**', selector: 'empty-catch' },
      remedy: { summary: 'handle it, rethrow it, or log why it is safe to ignore' },
    },
    {
      ...syntax,
      id: 'no-branching-on-a-literal-name',
      statement: 'behaviour is not selected by comparing against a hardcoded name',
      params: { appliesTo: 'src/rules/**', selector: 'string-literal-comparison' },
      remedy: { summary: 'put the behaviour behind a declared capability instead' },
    },
    {
      id: 'hooks-start-with-use',
      kind: 'naming',
      statement: 'a hook starts with use',
      severity: 'error',
      confidence: 'deterministic',
      params: { appliesTo: 'src/hooks/**', target: 'exports', prefixes: ['use'] },
      remedy: { summary: 'rename it to useSomething, or move it out of hooks/' },
    },
    {
      id: 'filenames-are-camel-case',
      kind: 'naming',
      statement: 'a filename is camelCase, with no underscores and no kebab-case',
      severity: 'error',
      confidence: 'deterministic',
      params: { appliesTo: 'src/**', target: 'files', pattern: '^[a-z][A-Za-z0-9]*\\.tsx?$' },
      remedy: { summary: 'rename the file to camelCase' },
    },
  ],
});

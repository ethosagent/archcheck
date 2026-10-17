import { defineArchitecture } from 'archcheck';

const ban = {
  kind: 'forbidden' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    {
      kind: 'layers',
      id: 'everything-is-the-domain',
      statement: 'this fixture has one layer, so the layer law is not what it tests',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'domain', match: 'src/**', mayImport: '*', catchesUnlayered: true },
      remedy: { summary: 'declare the layer this path belongs to' },
    },
    // The two rules `archcheck init` now generates, at error so the fixture proves them.
    {
      ...ban,
      id: 'production-code-does-not-import-a-test-file',
      statement: 'production code does not import a test file',
      params: {
        from: { glob: '**/*.ts' },
        to: { glob: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__mocks__/**'] },
        edges: 'production',
      },
      remedy: { summary: 'move the shared helper out of the test tree' },
    },
    {
      ...ban,
      id: 'production-code-does-not-import-a-testing-library',
      statement: 'production code does not import a testing library',
      params: {
        from: { glob: '**/*.ts' },
        to: { package: ['vitest', 'jest', '@jest/*', 'mocha', 'chai', '@testing-library/*'] },
        edges: 'production',
      },
      remedy: { summary: 'a testing library belongs to the tests' },
    },
  ],
});

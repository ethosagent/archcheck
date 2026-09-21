import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'no-deep-module-imports',
      kind: 'encapsulation',
      statement: 'a module is reached through its barrel, never through a path inside it',
      severity: 'error',
      confidence: 'deterministic',
      params: { module: 'modules/*', publicSurface: 'index.ts' },
      remedy: {
        summary: 'import the module barrel, and export the symbol from it if it is really public',
        allowed: ['index.ts'],
      },
    },
  ],
});

import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'contracts-import-nothing',
      kind: 'layers',
      statement: 'the contracts kernel imports nothing internal',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'contracts', match: 'src/contracts/**', mayImport: [] },
      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },
    },
    {
      id: 'rules-are-pure',
      kind: 'layers',
      statement: 'a rule imports nothing but types',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        name: 'rules',
        match: 'src/rules/**',
        mayImport: ['contracts'],
        catchesUnlayered: true,
      },
      remedy: { summary: 'take the value as an argument instead of reaching for it' },
    },
  ],
});

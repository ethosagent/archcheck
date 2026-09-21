import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'the-surviving-rule',
      kind: 'layers',
      statement: 'a layer imports only what it declares',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'a', match: 'a/**', mayImport: [] },
      remedy: { summary: 'declare it or do not import it' },
    },
  ],
});

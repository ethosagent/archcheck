import { defineArchitecture } from 'archcheck';

const shared = {
  kind: 'layers' as const,
  statement: 'a layer imports only what it declares',
  severity: 'error' as const,
  confidence: 'deterministic' as const,
  remedy: { summary: 'declare it or do not import it' },
};

export default defineArchitecture({
  rules: [
    { ...shared, id: 'same-id', params: { name: 'a', match: 'a/**', mayImport: [] } },
    { ...shared, id: 'same-id', params: { name: 'b', match: 'b/**', mayImport: [] } },
  ],
});

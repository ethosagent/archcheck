import { defineArchitecture } from 'archcheck';

const law = {
  kind: 'layers' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    {
      ...law,
      id: 'features-are-independent',
      statement: 'one feature does not reach into another feature',
      params: {
        name: 'features',
        match: 'src/features/*/**',
        mayImport: ['shared'],
        siblings: 'deny',
        unit: 'src/features/*',
        catchesUnlayered: true,
      },
      remedy: { summary: 'move the shared code into src/shared, or call through an event' },
    },
    {
      ...law,
      id: 'shared-imports-nothing',
      statement: 'shared code imports nothing of its own',
      params: { name: 'shared', match: 'src/shared/**', mayImport: [] },
      remedy: { summary: 'take it as an argument instead' },
    },
  ],
});

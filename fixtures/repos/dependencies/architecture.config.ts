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
      id: 'the-domain-decides',
      statement: 'the domain decides, and reaches for one validator and nothing else',
      params: {
        name: 'domain',
        match: 'src/domain/**',
        mayImport: [],
        externals: { allow: ['zod'] },
        catchesUnlayered: true,
        // One rule owns the repository-wide audit. `bun-types` is a dependency the architecture
        // knowingly does not place: nothing imports it, and the compiler reads it.
        auditsDependencies: true,
        unassigned: ['bun-types'],
      },
      remedy: { summary: 'put the dependency in a layer that is allowed to import it' },
    },
    {
      ...law,
      id: 'a-service-calls-the-domain',
      statement: 'a service calls the domain, and never the other way round',
      params: { name: 'service', match: 'src/service/**', mayImport: ['domain'] },
      remedy: { summary: 'invert the call: the service calls the domain' },
    },
  ],
});

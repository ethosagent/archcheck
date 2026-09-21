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
      id: 'contracts-import-nothing',
      statement: 'the contracts kernel imports nothing internal',
      params: { name: 'contracts', match: 'packages/contracts/**', mayImport: [] },
      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },
    },
    {
      ...law,
      id: 'rules-are-pure',
      statement: 'a rule imports nothing but types',
      params: { name: 'rules', match: 'modules/*/rules/**', mayImport: ['contracts'] },
      remedy: { summary: 'take the value as an argument instead of reaching for it' },
    },
    {
      ...law,
      id: 'domain-no-service-import',
      statement: 'domain may import only contracts and rules',
      params: {
        name: 'domain',
        match: 'modules/*/domain/**',
        mayImport: ['contracts', 'rules'],
        catchesUnlayered: true,
      },
      remedy: {
        summary: 'invert the call: the service calls the domain, never the reverse',
        allowed: ['contracts', 'rules'],
      },
    },
    {
      ...law,
      id: 'services-orchestrate-only',
      statement: 'a service sequences the domain and owns the transaction',
      params: {
        name: 'service',
        match: 'modules/*/services/**',
        mayImport: ['contracts', 'rules', 'domain', 'repository'],
      },
      remedy: { summary: 'move the decision into the domain and call it from here' },
    },
    {
      ...law,
      id: 'repositories-reach-contracts-only',
      statement: 'a repository talks to the outside world and to contracts, nothing else',
      params: { name: 'repository', match: 'modules/*/repositories/**', mayImport: ['contracts'] },
      remedy: { summary: 'take what you need as an argument from the service' },
    },
  ],
});

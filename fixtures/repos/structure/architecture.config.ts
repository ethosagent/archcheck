import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'every-port-has-a-memory-twin',
      kind: 'required-file',
      statement: 'every port ships a memory twin, so a consumer can be tested without the real thing',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        forEach: 'src/ports/*.ts',
        expect: 'src/adapters/memory{Base}.ts',
      },
      remedy: { summary: 'write the twin beside the real implementation, and run one suite on both' },
    },
    {
      id: 'endpoints-declare-a-permission',
      kind: 'declared-field',
      statement: 'every endpoint declares the permission it needs',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        appliesTo: 'src/routes/**',
        on: 'registerRoute',
        field: 'permission',
        allowed: ['events.read', 'events.write'],
      },
      remedy: { summary: 'add permission: to the route spec, and register it if it is new' },
    },
  ],
});

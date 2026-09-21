import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'points-at-a-layer-that-does-not-exist',
      kind: 'layers',
      statement: 'domain may import only contracts',
      severity: 'error',
      confidence: 'deterministic',
      // `contracts` is never declared as a layer, which is the commonest manifest typo.
      params: { name: 'domain', match: 'src/domain/**', mayImport: ['contracts'] },
      remedy: { summary: 'declare the contracts layer, or remove it from mayImport' },
    },
  ],
});

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
      id: 'forbidden-is-its-own-layer',
      kind: 'layers',
      statement: 'the forbidden layer reaches nothing',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'forbidden', match: 'src/forbidden/**', mayImport: [] },
      remedy: { summary: 'do not put anything here' },
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
  exceptions: [
    {
      rule: 'rules-are-pure',
      path: 'src/rules/**',
      owner: 'mitesh',
      // Deliberately in the past, and it stays in the past: the expiry must be ENFORCED, so this
      // fixture has to fail on every future day too.
      expires: '2020-01-01',
      reason: 'a fixture: an expired allowance must fail the run rather than keep suppressing',
    },
  ],
});

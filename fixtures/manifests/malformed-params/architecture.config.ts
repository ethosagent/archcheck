import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'bad-severity-and-kind',
      // @ts-expect-error deliberately not a member of the closed set
      kind: 'vibes',
      statement: 'something',
      // @ts-expect-error deliberately not a severity
      severity: 'loud',
      confidence: 'deterministic',
      params: {},
      remedy: { summary: '' },
    },
  ],
});

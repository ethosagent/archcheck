import { defineArchitecture } from 'archcheck';

// One layer rule per layer. Anything you do not declare is forbidden.
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
      statement: 'the contracts layer imports nothing',
      params: { name: 'contracts', match: 'src/contracts/**', mayImport: [] },
      remedy: { summary: 'move the shared type into contracts, or stop sharing it' },
    },
    {
      ...law,
      id: 'rules-are-pure',
      statement: 'a rule reads types and nothing else',
      params: { name: 'rules', match: 'src/rules/**', mayImport: ['contracts'] },
      remedy: { summary: 'take the value as an argument' },
    },
    {
      ...law,
      id: 'domain-decides-alone',
      statement: 'the domain reads contracts and rules',
      params: {
        name: 'domain',
        match: 'src/domain/**',
        mayImport: ['contracts', 'rules'],
      },
      remedy: { summary: 'invert the call: the service calls the domain' },
    },
    {
      ...law,
      id: 'services-sequence-only',
      statement: 'a service sequences the domain and the repositories',
      params: {
        name: 'services',
        match: 'src/services/**',
        mayImport: ['contracts', 'rules', 'domain'],
      },
      remedy: { summary: 'move the decision into the domain' },
    },
    {
      ...law,
      id: 'repositories-read-contracts-only',
      statement: 'a repository reads contracts and nothing else',
      params: { name: 'repositories', match: 'src/repositories/**', mayImport: ['contracts'] },
      remedy: { summary: 'take what you need as an argument from the service' },
    },
    {
      ...law,
      id: 'the-entry-point-wires-everything',
      statement: 'the entry point is the only place that chooses an implementation',
      params: {
        name: 'entry',
        match: 'src/entry/**',
        mayImport: '*',
        // Exactly one layers rule owns the report for a file in no layer. Put it on the rule that
        // cannot fire any other way: this layer may import anything, so an undeclared folder is
        // the only violation it can have.
        catchesUnlayered: true,
      },
      remedy: { summary: 'bind it in src/entry/main.ts' },
    },
    {
      id: 'no-console-outside-the-entry-point',
      kind: 'banned-syntax',
      statement: 'logging goes through one seam, so the service stays embeddable',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        appliesTo: ['src/**', '!src/entry/**'],
        selector: 'member-access',
        target: 'console',
      },
      remedy: { summary: 'return the text, and let the entry point print it' },
    },
    {
      id: 'every-error-rule-has-a-fixture',
      kind: 'required-file',
      statement: 'every error-severity rule has a fixture it catches',
      severity: 'error',
      confidence: 'deterministic',
      params: {
        forEach: 'rule[severity=error]',
        expect: 'fixtures/rules/{id}.violation.ts',
      },
      remedy: { summary: 'add a file that deliberately breaks this rule' },
    },
  ],
});

import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'domain-no-service-import',
      kind: 'layers',
      statement: 'domain may import only contracts and rules',
      severity: 'error',
      confidence: 'deterministic',
      params: { name: 'domain', match: 'modules/*/domain/**', mayImport: ['contracts', 'rules'] },
      remedy: {
        summary: 'invert the call: the service calls the domain, never the reverse',
        allowed: ['contracts', 'rules'],
      },
    },
    {
      id: 'controllers-stay-thin',
      kind: 'judgement',
      statement: 'a controller validates, delegates and shapes — it decides nothing',
      severity: 'advisory',
      confidence: 'model',
      params: { statement: 'no business branch in a controller', appliesTo: 'controllers/**' },
      remedy: { summary: 'move the branch into the domain' },
    },
    {
      id: 'retired-rule-off',
      kind: 'naming',
      statement: 'hooks start with use',
      severity: 'off',
      confidence: 'deterministic',
      params: { appliesTo: 'src/**', prefixes: ['use'] },
      remedy: { summary: 'rename it' },
    },
  ],
});

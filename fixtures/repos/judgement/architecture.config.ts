import { defineArchitecture } from 'archcheck';

export default defineArchitecture({
  rules: [
    {
      id: 'controllers-stay-thin',
      kind: 'judgement',
      statement: 'a controller validates, delegates and shapes — it decides nothing',
      // Advisory by default. A non-deterministic blocking gate is how a check suite loses trust.
      severity: 'advisory',
      confidence: 'model',
      params: {
        statement:
          'A controller must not contain a branch that decides a business outcome. Validation and ' +
          'response shaping are fine; a rule about money, limits or eligibility belongs in the domain.',
        appliesTo: 'src/routes/**',
        examples: {
          pass: [
            'if (!Number.isFinite(amount)) throw new Error("amount must be a number");',
            'return decideWithdrawal(amount, balance);',
          ],
          fail: [
            'if (amount > balance * 0.9) return "declined: under the floor";',
            'const fee = amount > 10000 ? amount * 0.01 : 0;',
          ],
        },
        cite: 'the branch that decides the outcome',
      },
      remedy: { summary: 'move the decision into the domain and call it from the controller' },
    },
  ],
});

import { defineArchitecture } from 'archcheck';

const ban = {
  kind: 'forbidden' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    ...(['checkout', 'payments', 'cart', 'legacy'] as const).map((name, index) => ({
      kind: 'layers' as const,
      id: `${name}-is-declared`,
      statement: `${name} is a declared layer`,
      severity: 'error' as const,
      confidence: 'deterministic' as const,
      params: {
        name,
        match: `src/${name}/**`,
        mayImport: '*' as const,
        ...(index === 0 ? { catchesUnlayered: true } : {}),
      },
      remedy: { summary: 'declare the layer this path belongs to' },
    })),
    {
      ...ban,
      id: 'the-cart-never-charges',
      statement: 'the cart does not talk to payments at all',
      params: { from: { layer: 'cart' }, to: { layer: 'payments' } },
      remedy: { summary: 'let the checkout own the charge' },
    },
    {
      ...ban,
      id: 'checkout-does-not-touch-the-payments-sdk',
      statement: 'checkout may not reach the payments SDK directly',
      params: { from: { glob: 'src/checkout/**' }, to: { glob: 'src/payments/**' } },
      remedy: { summary: 'go through the payments port instead' },
    },
    {
      ...ban,
      id: 'no-lodash',
      statement: 'lodash is not a dependency of this repository',
      params: { from: { glob: 'src/**' }, to: { package: 'lodash/*' } },
      remedy: { summary: 'use a standard library function' },
    },
    {
      ...ban,
      id: 'cart-does-not-reach-checkout',
      statement: 'the cart does not drive the checkout',
      params: {
        from: { glob: 'src/**', except: 'src/legacy/**' },
        to: { glob: 'src/checkout/**' },
      },
      remedy: { summary: 'raise an event the checkout listens for' },
    },
  ],
});

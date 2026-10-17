import { defineArchitecture } from 'archcheck';

const ban = {
  kind: 'forbidden' as const,
  severity: 'error' as const,
  confidence: 'deterministic' as const,
};

export default defineArchitecture({
  rules: [
    ...(['checkout', 'payments', 'cart', 'legacy', 'widget', 'handler'] as const).map(
      (name, index) => ({
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
      }),
    ),
    // A SECOND axis. Every layer on it allows every import, so the axis contributes no layer
    // finding of its own — the cross-dimension `forbidden` rule below is the only thing it feeds.
    // `shared` is declared LAST and matches everything, because first match wins: it is this
    // axis's elected owner of the unlayered report, which every axis must have.
    ...(
      [
        ['client', 'src/widget/**'],
        ['server', 'src/handler/**'],
        ['shared', 'src/**'],
      ] as const
    ).map(([name, match], index) => ({
      kind: 'layers' as const,
      id: `${name}-is-a-runtime`,
      statement: `${name} is a declared runtime`,
      severity: 'error' as const,
      confidence: 'deterministic' as const,
      params: {
        name,
        dimension: 'runtime',
        match,
        mayImport: '*' as const,
        ...(index === 2 ? { catchesUnlayered: true } : {}),
      },
      remedy: { summary: 'say which runtime this path belongs to' },
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
      id: 'the-client-never-calls-the-server-directly',
      statement: 'client code does not call a server module in process',
      params: { from: { runtime: 'client' }, to: { runtime: 'server' } },
      remedy: { summary: 'call it over the wire, or move the logic to a shared module' },
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

// A test doing exactly the same two things. Both are legitimate, and `edges: 'production'` is
// what keeps this file silent — it is the control for the rule above.
import { expect } from 'vitest';
import { fakeClock } from './fakes.test.js';
import { price } from './price.js';

export const run = (): void => {
  expect(price(1)).toBe(1 + fakeClock());
};

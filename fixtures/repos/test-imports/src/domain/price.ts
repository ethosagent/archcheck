// Production code reaching into the test tree, and into a testing library. Both are the violation.
import { expect } from 'vitest';
import { fakeClock } from './fakes.test.js';

export const price = (n: number): number => {
  expect(n).toBeGreaterThan(-1);
  return n + fakeClock();
};

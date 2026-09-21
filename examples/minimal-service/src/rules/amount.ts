import type { Entry } from '../contracts/types.js';

// A rule is a pure function. It reads no clock and calls nothing.
export function isPositive(entry: Entry): boolean {
  return entry.cents > 0;
}

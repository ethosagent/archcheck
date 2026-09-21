import type { Amount } from '../contracts/types.js';

// Legal: rules may reach contracts. Nothing here breaks any rule.
export function isPositive(amount: Amount): boolean {
  return amount.cents > 0;
}

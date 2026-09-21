import type { Entry } from '../../../packages/contracts/src/ledger.js';

// LEGAL: rules may import contracts. Pure — no I/O, no clock, no ports.
export function assertGrounded(entry: Entry): void {
  if (entry.amount === 0) throw new Error('an entry with no amount is not grounded');
}

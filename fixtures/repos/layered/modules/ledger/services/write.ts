import type { Entry } from '../../../packages/contracts/src/ledger.js';
import { assertGrounded } from '../rules/grounded.js';
import { appendEntry } from '../repositories/ledgerStore.js';

// LEGAL: a service may reach contracts, rules and repositories.
export async function writeEntry(entry: Entry): Promise<void> {
  assertGrounded(entry);
  await appendEntry(entry);
}

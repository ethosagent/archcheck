import type { Entry } from '../../../packages/contracts/src/ledger.js';

// LEGAL: a repository may reach contracts and nothing else.
const kept: Entry[] = [];

export async function appendEntry(entry: Entry): Promise<void> {
  kept.push(entry);
}

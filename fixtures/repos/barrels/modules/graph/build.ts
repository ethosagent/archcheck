// LEGAL: reaches the other module through its barrel.
import { writeEntry } from '../ledger/index.js';
// THE PLANTED VIOLATION: a deep import across a module boundary.
import { supersede } from '../ledger/domain/supersede.js';

export function buildGraph(id: string): string {
  return `${writeEntry(id)}|${supersede(id)}`;
}

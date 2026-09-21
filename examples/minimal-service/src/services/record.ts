import type { Entry, EntryStore } from '../contracts/types.js';
import { decide } from '../domain/decide.js';

// A service sequences the work. It owns no decision of its own.
export async function recordEntry(store: EntryStore, entry: Entry): Promise<string> {
  if (decide(entry) === 'reject') return 'rejected';
  await store.append(entry);
  return 'recorded';
}

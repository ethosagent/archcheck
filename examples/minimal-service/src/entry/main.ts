import { createMemoryEntryStore } from '../repositories/entryStore.js';
import { recordEntry } from '../services/record.js';

// The composition root. It is the only place that chooses an implementation, and the only place
// that writes to the console.
export async function main(): Promise<void> {
  const store = createMemoryEntryStore();
  const result = await recordEntry(store, { id: 'e1', cents: 250 });
  console.log(result);
}

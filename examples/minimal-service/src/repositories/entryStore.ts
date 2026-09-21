import type { Entry, EntryStore } from '../contracts/types.js';

// A repository talks to the outside world. It reads contracts and nothing else.
export function createMemoryEntryStore(): EntryStore {
  const kept: Entry[] = [];
  return {
    async append(entry) {
      kept.push(entry);
    },
  };
}

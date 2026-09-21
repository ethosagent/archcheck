import type { BlobStore } from '../ports/blobStore.js';

// The twin blobStore.ts needs, so that port is clean.
export function createMemoryBlobStore(): BlobStore {
  const kept = new Map<string, string>();
  return {
    async put(key, body) {
      kept.set(key, body);
    },
  };
}

import type { BlobStore as Store } from '../ports/blobStore.js';

// Factory style, and the port is aliased on import — both must still match `implements: BlobStore`.
export function createMemoryBlobStore(): Store {
  const kept = new Map<string, string>();
  return {
    async put(key: string, body: string) {
      kept.set(key, body);
    },
  };
}

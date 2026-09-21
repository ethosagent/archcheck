import type { BlobStore } from '../ports/blobStore.js';

export class RemoteBlobStore implements BlobStore {
  async put(key: string, body: string): Promise<void> {
    void key;
    void body;
  }
}

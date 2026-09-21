import { RemoteBlobStore } from '../adapters/remoteBlobStore.js';
import type { Clock } from '../ports/blobStore.js';
import { createHash } from 'node:crypto';

export { createMemoryBlobStore } from '../adapters/memoryBlobStore.js';

export async function literalDynamic() {
  return import('../adapters/remoteBlobStore.js');
}

export async function computedDynamic(which: string) {
  // The form that is invisible to a module-graph tool, and the form a layer violation hides in.
  return import(`../adapters/${which}.js`);
}

export function typedClock(clock: Clock): number {
  return clock.now();
}

export function digest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export const store = new RemoteBlobStore();

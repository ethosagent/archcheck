export type BlobStore = {
  put(key: string, body: string): Promise<void>;
};

export type Clock = { now(): number };

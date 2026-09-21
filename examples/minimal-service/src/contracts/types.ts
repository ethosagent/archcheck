// The contracts kernel. It imports nothing. Every other layer may read it.
export type Entry = { id: string; cents: number };

export type EntryStore = { append(entry: Entry): Promise<void> };

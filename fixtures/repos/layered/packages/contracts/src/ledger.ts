export type Entry = { id: string; amount: number; supersedes?: string };
export type LedgerStore = { append(entry: Entry): Promise<void> };

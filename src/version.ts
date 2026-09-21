/**
 * The schema version stamped on every Diagnostic.
 *
 * What this is for: an agent consuming `--format json` needs to know which shape it is reading
 * before it reads it. Bumping this is a breaking change to the agent contract, so it lives alone
 * in one file where a diff to it is impossible to miss.
 *
 * What a caller must know: nothing stamps this by hand. `normalize()` is the single producer,
 * so a Diagnostic cannot exist without the current version on it.
 */
export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

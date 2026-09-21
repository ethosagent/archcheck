// archcheck-fixture: place-at src/rules/fixtureViolation.ts
//
// The deliberate violation: a rule reaching a repository. A rule is pure.
import type { createMemoryEntryStore } from '../repositories/entryStore.js';

export type FixtureViolation = typeof createMemoryEntryStore;

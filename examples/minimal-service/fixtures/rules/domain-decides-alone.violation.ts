// archcheck-fixture: place-at src/domain/fixtureViolation.ts
//
// The deliberate violation: the domain reaching a service. The arrow points down, never back.
import type { recordEntry } from '../services/record.js';

export type FixtureViolation = typeof recordEntry;

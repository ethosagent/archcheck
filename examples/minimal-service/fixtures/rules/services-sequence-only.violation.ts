// archcheck-fixture: place-at src/services/fixtureViolation.ts
//
// The deliberate violation: a service reaching the entry point.
import type { main } from '../entry/main.js';

export type FixtureViolation = typeof main;

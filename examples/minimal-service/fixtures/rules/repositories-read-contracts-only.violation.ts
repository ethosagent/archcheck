// archcheck-fixture: place-at src/repositories/fixtureViolation.ts
//
// The deliberate violation: a repository reaching the domain.
import type { decide } from '../domain/decide.js';

export type FixtureViolation = typeof decide;

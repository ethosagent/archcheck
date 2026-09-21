// archcheck-fixture: place-at src/contracts/fixtureViolation.ts
//
// The deliberate violation: contracts reaching a rule. The kernel must import nothing.
import type { isPositive } from '../rules/amount.js';

export type FixtureViolation = typeof isPositive;

// archcheck-fixture: place-at src/coverage/fixtureViolation.ts
//
// The deliberate violation: coverage reaching for a utility instead of taking what it needs as an argument.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { matches } from '../util/glob.js';

export type FixtureViolation = matches;

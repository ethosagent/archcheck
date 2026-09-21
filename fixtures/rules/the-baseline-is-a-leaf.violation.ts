// archcheck-fixture: place-at src/baseline/fixtureViolation.ts
//
// The deliberate violation: the baseline reaching a utility, instead of keying only off identity.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { matches } from '../util/glob.js';

export type FixtureViolation = matches;

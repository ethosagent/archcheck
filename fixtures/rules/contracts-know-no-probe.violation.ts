// archcheck-fixture: place-at src/contracts/fixtureViolation.ts
//
// The deliberate violation: a contract kind reaching a probe, instead of returning its decision as data.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Skip } from '../probes/types.js';

export type FixtureViolation = Skip;

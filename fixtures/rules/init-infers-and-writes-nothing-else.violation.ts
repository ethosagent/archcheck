// archcheck-fixture: place-at src/init/fixtureViolation.ts
//
// The deliberate violation: init reaching a probe, instead of inferring from the folders and the
// graph and stopping there.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Skip } from '../probes/types.js';

export type FixtureViolation = Skip;

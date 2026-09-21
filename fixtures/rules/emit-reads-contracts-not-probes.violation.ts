// archcheck-fixture: place-at src/emit/fixtureViolation.ts
//
// The deliberate violation: the emitter reaching a probe, instead of staying a pure function of the manifest.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Skip } from '../probes/types.js';

export type FixtureViolation = Skip;

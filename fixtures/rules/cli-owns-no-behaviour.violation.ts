// archcheck-fixture: place-at src/cli/fixtureViolation.ts
//
// The deliberate violation: the CLI reaching the graph directly, instead of going through the facade.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

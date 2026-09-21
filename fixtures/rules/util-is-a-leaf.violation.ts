// archcheck-fixture: place-at src/util/fixtureViolation.ts
//
// The deliberate violation: a utility reaching the graph, instead of taking what it needs as an argument.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

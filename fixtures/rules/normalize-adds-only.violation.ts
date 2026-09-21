// archcheck-fixture: place-at src/normalize/fixtureViolation.ts
//
// The deliberate violation: the normaliser reaching the graph, instead of enriching what it was handed.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

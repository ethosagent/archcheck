// archcheck-fixture: place-at src/registry/fixtureViolation.ts
//
// The deliberate violation: the registry reaching the graph, instead of having behaviour injected.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

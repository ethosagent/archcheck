// archcheck-fixture: place-at src/fs/fixtureViolation.ts
//
// The deliberate violation: the filesystem seam reaching the graph, instead of only reading and writing.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

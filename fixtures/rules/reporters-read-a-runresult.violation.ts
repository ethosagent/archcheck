// archcheck-fixture: place-at src/report/fixtureViolation.ts
//
// The deliberate violation: a reporter reaching past the RunResult it was given.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Edge } from '../graph/types.js';

export type FixtureViolation = Edge;

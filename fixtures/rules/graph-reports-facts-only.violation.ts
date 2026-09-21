// archcheck-fixture: place-at src/graph/fixtureViolation.ts
//
// The deliberate violation: the graph reader reaching a reporter, instead of only observing.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { ReportCtx } from '../report/types.js';

export type FixtureViolation = ReportCtx;

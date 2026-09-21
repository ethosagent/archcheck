// archcheck-fixture: place-at src/probes/fixtureViolation.ts
//
// The deliberate violation: a probe reaching a reporter, instead of returning evidence.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { ReportCtx } from '../report/types.js';

export type FixtureViolation = ReportCtx;

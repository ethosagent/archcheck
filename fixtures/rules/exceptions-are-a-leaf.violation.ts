// archcheck-fixture: place-at src/exceptions/fixtureViolation.ts
//
// The deliberate violation: exceptions reaching the registry instead of taking the diagnostics as an argument.
// Type-only, so the fixture compiles on its own and the edge is still a dependency —
// a type-only import crosses a layer boundary exactly as a value import does.
import type { Registry } from '../registry/index.js';

export type FixtureViolation = Registry;

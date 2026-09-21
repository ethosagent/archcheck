// archcheck-fixture: append-to architecture.config.ts
//
// The manifest layer matches `architecture.config.ts` exactly, so this is appended too.
// Type-only on purpose: the manifest is EVALUATED at load time, and a value import of a .ts file
// would fail the load with a config error instead of producing the layer violation under test.
import type { Edge } from './src/graph/types.js';

export type FixtureViolation = Edge;

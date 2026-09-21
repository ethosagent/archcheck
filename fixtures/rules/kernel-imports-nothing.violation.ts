// archcheck-fixture: append-to src/version.ts
//
// The kernel layer matches an exact list of files, so a fixture cannot be a NEW file — it has to
// make one of the existing three reach for something. Appended rather than placed, which is why
// this directive is `append-to`.
import type { Edge } from './graph/types.js';

export type FixtureViolation = Edge;

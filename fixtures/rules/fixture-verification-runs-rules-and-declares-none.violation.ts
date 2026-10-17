// archcheck-fixture: place-at src/fixtures/reachesAContract.ts
//
// Deliberately breaks `fixture-verification-runs-rules-and-declares-none`. Fixture verification
// places a fixture and runs the checks; it declares no rule, so it has no business reaching into
// a contract kind to ask what one means.
import { layersContract } from '../contracts/layers.js';

export const kind = layersContract.kind;

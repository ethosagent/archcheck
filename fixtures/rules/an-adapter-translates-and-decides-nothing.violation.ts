// archcheck-fixture: place-at src/adapters/decidesSomething.ts
//
// Deliberately breaks `an-adapter-translates-and-decides-nothing`. An adapter turns a generated
// sink into another tool's shape; reaching for a contract kind to ask what a rule MEANS is
// deciding, and the decision belongs in the manifest.
import { layersContract } from '../contracts/layers.js';

export const kind = layersContract.kind;

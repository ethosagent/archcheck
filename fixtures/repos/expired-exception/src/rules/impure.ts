// A real violation: a rule reaching a layer it may not. It is covered by an exception that has
// already expired, so the run must fail and name the owner rather than quietly allow it.
import { forbidden } from '../forbidden/thing.js';

export const leak = forbidden;

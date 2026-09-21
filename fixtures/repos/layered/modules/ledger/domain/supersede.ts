import type { Entry } from '../../../packages/contracts/src/ledger.js';
import { assertGrounded } from '../rules/grounded.js';
import { writeEntry } from '../services/write.js';

// The planted violation: domain reaches back up into services. Line 4, so that moving this
// comment block proves the identity hash does not depend on position.
export async function supersede(previous: Entry, next: Entry): Promise<void> {
  assertGrounded(next);
  await writeEntry({ ...next, supersedes: previous.id });
}

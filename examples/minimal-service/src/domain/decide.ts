import type { Entry } from '../contracts/types.js';
import { isPositive } from '../rules/amount.js';

// The domain decides. This is the layer a second implementation could replace.
export function decide(entry: Entry): 'accept' | 'reject' {
  return isPositive(entry) ? 'accept' : 'reject';
}

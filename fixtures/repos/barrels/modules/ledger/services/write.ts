// LEGAL: same module. An internal import is not a barrel violation.
import { supersede } from '../domain/supersede.js';

export function writeEntry(id: string): string {
  return supersede(id);
}

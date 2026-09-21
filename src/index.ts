/**
 * archcheck's public surface. The facade plus the types a consumer or an agent needs to read
 * a RunResult. Nothing here has behaviour of its own — it re-exports, with explicit named
 * exports only so a dead-code pass can find a symbol nobody consumes.
 */

export { allOk, err, ok, type Result } from './result.js';
export {
  CONTRACT_KINDS,
  type Confidence,
  type ContractKind,
  type Coverage,
  type Diagnostic,
  type Fragment,
  type FragmentTarget,
  type RawFinding,
  type Remedy,
  type Rule,
  type RunResult,
  type Severity,
  type SkipRecord,
} from './types.js';
export { SCHEMA_VERSION, type SchemaVersion } from './version.js';

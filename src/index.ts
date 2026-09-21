/**
 * archcheck's public surface.
 *
 * What a caller must know: this is what `import ... from 'archcheck'` gets. Explicit named exports
 * only — never `export *`, so a dead-code pass can find a symbol nobody consumes. Nothing here has
 * behaviour of its own; it re-exports the facade and the types an agent needs to read a RunResult.
 */
export {
  type ArchCheck,
  type BaselineOutcome,
  buildInitManifest,
  type CheckOptions,
  CONFIG_FILENAME,
  describeViolations,
  type EmitResult,
  EXIT,
  type ExitCode,
  exitCodeFor,
  inferLayers,
  initSummary,
  type LoadOptions,
  load,
  renderManifest,
} from './archcheck.js';
export {
  BASELINE_PATH,
  type Baseline,
  identitiesOf,
  readBaseline,
} from './baseline/index.js';
export {
  type ContractType,
  type EmitCtx,
  type ExplainCtx,
  implementedKinds,
  type Refinement,
  type ValidateCtx,
} from './contracts/index.js';
export {
  automatablePercent,
  FENCE_BEGIN,
  FENCE_END,
  MARK,
  RULES_JSON,
  type RuleSummary,
  type RulesDocument,
  renderRulesTable,
  replaceFencedRegion,
  rulesDocument,
} from './coverage/index.js';
export {
  type ArchitectureException,
  applyExceptions,
  todayIso,
  validateExceptions,
} from './exceptions/index.js';
export {
  createMemoryFileSystem,
  createNodeFileSystem,
  type FileSystem,
} from './fs/index.js';
export {
  type Budget,
  createModelProbe,
  DEFAULT_BUDGET,
  DEFAULT_MODEL,
  type JudgeRequest,
  type JudgeResponse,
  type JudgeVerdict,
  type LlmProvider,
} from './probes/model/index.js';
export { type ArchitectureManifest, defineArchitecture } from './registry/define.js';
export type { Registry } from './registry/index.js';
export {
  type JsonReport,
  type ReportCtx,
  type Reporter,
  type ReporterName,
  reporterFor,
  reporterNames,
  type Verdict,
  verdictFor,
} from './report/index.js';
export { allOk, err, ok, type Result } from './result.js';
export {
  type BaselineEntry,
  CONTRACT_KINDS,
  type Confidence,
  type ContractKind,
  type Coverage,
  type Diagnostic,
  type ExceptionStatus,
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

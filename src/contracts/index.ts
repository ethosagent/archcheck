export {
  asBannedSyntaxParams,
  BANNED_CONSTRUCTS,
  type BannedConstruct,
  type BannedOccurrence,
  type BannedSyntaxParams,
  bannedSyntaxApplies,
  bannedSyntaxContract,
  bannedSyntaxRequest,
  findBannedOccurrences,
} from './banned-syntax.js';
export {
  asDeclaredFieldParams,
  type DeclaredFieldParams,
  declaredFieldApplies,
  declaredFieldContract,
  declaredFieldRequest,
  findMissingDeclarations,
  type MissingDeclaration,
} from './declared-field.js';
export {
  type AuditPolicy,
  dependencyNamesOf,
  type PackageLike,
  unapprovedDependencies,
} from './dependencyAudit.js';
export {
  asEncapsulationParams,
  type EncapsulationParams,
  type EncapsulationVerdict,
  encapsulationContract,
  moduleOf,
  publicSurfacesOf,
  resolveEncapsulation,
} from './encapsulation.js';
export {
  asForbiddenParams,
  type ForbiddenParams,
  forbiddenApplies,
  forbiddenContract,
} from './forbidden.js';
export {
  dimensionProblems,
  dimensionsOfSide,
  type LayerNames,
  RESERVED_SIDE_KEYS,
  type SideLike,
  sideDimensionsMatch,
} from './forbiddenDimensions.js';
export {
  type EdgeFacts,
  type ForbiddenSide,
  type ForbiddenTarget,
  sideMatches,
  targetMatches,
} from './forbiddenMatch.js';
export {
  asJudgementParams,
  effectiveConfidence,
  type JudgementParams,
  judgementApplies,
  judgementContract,
} from './judgement.js';
export {
  asLayersParams,
  buildLayerTable,
  type DependencyAudit,
  type EdgeVerdict,
  type Layer,
  type LayersParams,
  type LayerTable,
  layersContract,
  resolveEdge,
} from './layers.js';
export {
  asNamingParams,
  describeExpectation,
  type NamingParams,
  type NamingTarget,
  nameIsWellFormed,
  namingApplies,
  namingContract,
} from './naming.js';
export { packageMatches, packageMatchesAny } from './packageMatch.js';
export { contractFor, implementedKinds, validateParamsByKind, warningsFor } from './registry.js';
export {
  asRequiredFileParams,
  isRuleSelector,
  type RequiredFileParams,
  type RequiredSubject,
  requiredFileContract,
  subjectsFor,
} from './required-file.js';
export {
  resolveSiblingEdge,
  type SiblingPolicy,
  type SiblingVerdict,
  unitOf,
} from './siblings.js';
export { syntaxRequestsOf } from './syntaxRequests.js';
export type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

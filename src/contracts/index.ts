export {
  asBannedSyntaxParams,
  BANNED_CONSTRUCTS,
  type BannedConstruct,
  type BannedOccurrence,
  type BannedSyntaxParams,
  bannedSyntaxApplies,
  bannedSyntaxContract,
  findBannedOccurrences,
} from './banned-syntax.js';
export {
  asDeclaredFieldParams,
  type DeclaredFieldParams,
  declaredFieldApplies,
  declaredFieldContract,
  findMissingDeclarations,
  type MissingDeclaration,
} from './declared-field.js';
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
  asLayersParams,
  buildLayerTable,
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
export { contractFor, implementedKinds, validateParamsByKind } from './registry.js';
export {
  asRequiredFileParams,
  isRuleSelector,
  type RequiredFileParams,
  type RequiredSubject,
  requiredFileContract,
  subjectsFor,
} from './required-file.js';
export type { ContractType, EmitCtx, ExplainCtx, Refinement, ValidateCtx } from './types.js';

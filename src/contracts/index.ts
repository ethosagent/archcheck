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
export { contractFor, implementedKinds, validateParamsByKind } from './registry.js';
export type { ContractType, EmitCtx, ValidateCtx } from './types.js';

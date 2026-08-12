export { buildScene } from "./core/build-scene.js";
export {
  MAX_SCENE_NODES,
  SCENE_SCHEMA_VERSION,
  TARGET_CONTRACT,
} from "./core/constants.js";
export {
  DiagnosticCauseSchema,
  DiagnosticPhaseSchema,
  RenderDiagnosticCodeSchema,
  RenderDiagnosticSchema,
  type DiagnosticCause,
  type DiagnosticPhase,
  type RenderDiagnostic,
  type RenderDiagnosticCode,
} from "./core/diagnostics.js";
export {
  PortFailureKindSchema,
  PortOperationFailureSchema,
  PortOperationResultSchema,
  PortOperationSuccessSchema,
  PortValueFailureSchema,
  PortValueResultSchema,
  createPortValueResultSchema,
  createPortValueSuccessSchema,
  isPortOperationSuccess,
  isPortValueSuccess,
  type PortFailureKind,
  type PortOperationResult,
  type PortValueResult,
  type RenderCancellation,
  type RenderImageLease,
  type RenderImageLoader,
  type RenderPorts,
  type TransactionalRenderDriver,
} from "./core/ports.js";
export {
  RenderImageLeaseMetadataSchema,
  RenderOwnerSchema,
  RenderRepresentationSchema,
  RenderResourceDescriptorSchema,
  RenderResourceRequestSchema,
  RenderTargetFrameSchema,
  RenderTargetSchema,
  SceneResourceResultSchema,
  type RenderImageLeaseMetadata,
  type RenderOwner,
  type RenderRepresentation,
  type RenderResourceDescriptor,
  type RenderResourceRequest,
  type RenderResourceResolver,
  type RenderTarget,
  type RenderTargetFrame,
  type SceneResourceResult,
} from "./core/resources.js";
export {
  RGBA8_CHANNELS,
  compositeSourceOverRgba8Image,
  compositeSourceOverRgba8Pixel,
  createTransparentRgba8Image,
  roundHalfUp,
  type Rgba8Image,
  type Rgba8Pixel,
} from "./core/rgba8.js";
export {
  createReferenceRgba8Driver,
  type ReferenceRgba8CommittedFrame,
  type ReferenceRgba8Staging,
} from "./core/reference-driver.js";
export {
  RenderFailureSchema,
  RenderResultSchema,
  createRenderResultSchema,
  createRenderSuccessSchema,
  renderScene,
  type RenderResult,
} from "./core/renderer.js";
export {
  SceneBuildInputSchema,
  SceneBuildResultSchema,
  SceneGraphSchema,
  SceneNodeSchema,
  ScenePlacementSchema,
  type SceneBuildInput,
  type SceneBuildResult,
  type SceneGraph,
  type SceneNode,
  type ScenePlacement,
} from "./core/scene-schema.js";

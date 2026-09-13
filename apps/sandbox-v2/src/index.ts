/**
 * @composer-assistant/sandbox-v2 — Sandbox V2 typed-capability kernel
 * (Sandbox V2 M1–M7).
 *
 * Exports the V2 vocabulary, capability registry, operator-owned project
 * read registry, request validation, the typed dispatcher seam, the
 * read-only project-inspection family, M3 workspace experiments, the
 * M4 verification kernel, and the M5 authorship kernel. All boundaries fail
 * closed.
 */

export {
  SANDBOX_V2_OPERATION_NAMES,
  V2_DEFERRED_OPERATIONS,
  V2_CAPABILITY_REGISTRY,
  v2CapabilitySpec,
  isSandboxV2Request,
  isProjectReadFileResult,
  isProjectListDirectoryResult,
  isProjectSearchTextResult,
  isSandboxV2OperationResult,
  isWorkspaceVerifyResult,
  isChangesetAuthorResult,
  isPatchExportResult,
} from "./v2-types.js";
export type {
  SandboxV2OperationName,
  SandboxV2Request,
  SandboxV2Result,
  SandboxV2ExecutionTruth,
  SandboxV2OperationResult,
  SandboxV2CapabilitySpec,
  SandboxV2InspectionEntry,
  SandboxV2SearchMatch,
  SandboxV2FileRoundtripRequest,
  SandboxV2ProjectReadFileRequest,
  SandboxV2ProjectListDirectoryRequest,
  SandboxV2ProjectSearchTextRequest,
  SandboxV2WorkspaceReadFileRequest,
  SandboxV2WorkspaceListDirectoryRequest,
  SandboxV2WorkspaceSearchTextRequest,
  SandboxV2WorkspaceWriteFileRequest,
  SandboxV2WorkspaceReplaceFileRequest,
  SandboxV2WorkspaceEditTextRequest,
  SandboxV2WorkspaceDeleteFileRequest,
  SandboxV2WorkspaceCreateDirectoryRequest,
  SandboxV2WorkspaceVerifyRequest,
  SandboxV2WorkspaceAuthorRequest,
  SandboxV2PatchExportRequest,
  SandboxV2WorkspaceRequest,
  SandboxV2ChangedPath,
  SandboxV2SourceCleanliness,
  VerificationProtocolState,
  VerificationOutcome,
} from "./v2-types.js";

export { V2_LIMITS, V2_HOST_FACTS, V2_SECRET_ENV_KEY } from "./limits.js";

export {
  V2ProjectReadRegistry,
  type ProjectReadResolution,
} from "./registry.js";

export {
  validateProjectInspectionRequest,
  type ProjectInspectionValidation,
} from "./validation.js";

export { SANDBOX_V2_INSPECTION_RUNNER_SOURCE } from "./project-inspection/runner.js";
export {
  isInspectionRunnerEvidence,
  type InspectionRunnerChecks,
  type InspectionRunnerEvidence,
} from "./project-inspection/evidence.js";
export {
  buildSanitizedProjectView,
  removeProjectView,
  V2_VIEW_COPY_LIMITS,
  type ProjectSourceViewResult,
} from "./project-inspection/source-view.js";
export {
  executeProjectInspection,
  spawnBubblewrapInspection,
  isV2InspectionAvailable,
  type ProjectInspectionExecutorOptions,
  type InspectionSpawn,
  type InspectionSpawnInput,
  type InspectionSpawnOutput,
} from "./project-inspection/executor.js";

export {
  executeWorkspaceExperiment,
  spawnBubblewrapInspection as workspaceSpawnBubblewrapInspection,
  type WorkspaceExperimentExecutorOptions,
  type WorkspaceExperimentSpawn,
  type WorkspaceExperimentSpawnInput,
  type WorkspaceExperimentSpawnOutput,
} from "./workspace/executor.js";

export {
  WorkspaceManager,
  type WorkspaceManagerOptions,
  type WorkspaceAcquisitionResult,
  type WorkspaceManifest,
} from "./workspace/workspace-manager.js";

export {
  RecipeCatalog,
  createFirstSliceRecipeCatalog,
  validateWorkspaceVerifyRequest,
  typescriptFixtureCompileV1,
} from "./verification/recipe-catalog.js";
export type { RecipeDefinition, RecipeRecord } from "./verification/recipe-catalog.js";
export {
  executeCandidateVerification,
  spawnBubblewrapVerification,
  isV2VerificationAvailable,
  buildVerificationBwrapArgs,
  type CandidateVerificationExecutorOptions,
  type VerificationSpawn,
  type VerificationSpawnInput,
  type VerificationSpawnOutput,
} from "./verification/executor.js";
export {
  computeProvisionalCandidateTreeHash,
  bindCandidateSnapshot,
  PROVISIONAL_TREE_HASH_ALGORITHM,
} from "./verification/snapshot.js";

export {
  executeCandidateAuthorship,
  validateChangesetAuthorRequest,
} from "./authorship/executor.js";
export { scanAuthorshipText } from "./authorship/secret-scan.js";
export {
  M5_APPLY_FORBIDDEN_OPERATIONS,
  isM5ApplyForbiddenOperation,
  refuseApplyCandidateChangeSet,
} from "./authorship/apply.js";

export {
  executePatchExport,
  validatePatchExportRequest,
} from "./export/executor.js";
export {
  M7_FORBIDDEN_PROFILES,
  isForbiddenM7Profile,
  refuseUnadmittedM7Profile,
} from "./export/forbidden.js";

export {
  M6_MAX_STEPS,
  M6_MAX_OBJECTIVE_CHARS,
  M6_MAX_WALL_MS,
  M6_FORBIDDEN_EFFECT_OPERATIONS,
} from "./operate/limits.js";
export {
  admitBoundedOperationSequence,
  runBoundedOperation,
} from "./operate/controller.js";
export type {
  M6ControllerResult,
  M6StepExecution,
  M6StepRecord,
  M6StepSpec,
  M6StopReason,
} from "./operate/types.js";

export {
  handleFileRoundtripV2,
  isM1RoundtripAvailable,
  type M1RoundtripExecutorOptions,
} from "./adapters/m1-roundtrip.js";

export { SandboxV2Dispatcher, type SandboxV2Environment, type SandboxV2DispatchOptions }
  from "./dispatch.js";

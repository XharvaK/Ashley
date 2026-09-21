import type { DatabaseSync } from "node:sqlite";
import { env } from "../../../env.js";
import {
  executeCandidateAuthorshipV2,
  executeCandidateVerificationV2,
  executeInquiryExperimentV2,
  executeProjectInspectionV2,
  executeWorkspaceExperimentV2,
  type ExecuteCandidateAuthorshipV2Result,
  type ExecuteCandidateVerificationV2Result,
  type ExecuteInquiryExperimentV2Result,
  type ExecuteProjectInspectionV2Result,
  type ExecuteWorkspaceExperimentV2Result,
  type InquiryExperimentRequest,
} from "../../sandbox/v2-execution.js";
import {
  C1_OPENCODE_FREE_CATALOG,
  createQuotaRouter,
  executeModeBWorker,
  loadQuotaState,
  routeWorkerTask,
  resolveOpenCodeBinary,
  saveQuotaState,
  MODE_B_DEVELOP,
  MODE_B_INVESTIGATE,
  type ModeBWorkerResult,
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  WORKER_FINALIZATION_RESERVE_MS,
} from "../../sandbox/opencode/index.js";
import {
  executePatchExportV2,
  type ExecutePatchExportV2Result,
} from "../../sandbox/patch-export-execution.js";
import {
  canOfferCandidateWorkspace,
  canOfferProjectInspection,
  canOfferWorkerBackedProjectInspection,
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "../../sandbox/project-registry.js";
import type { SandboxV2Dispatcher, SandboxV2Environment, WorkspaceManager } from "@composer-assistant/sandbox-v2";
import type {
  CognitionAuthorshipRequest,
  CognitionInspectionRequest,
  CognitionPatchExportRequest,
  CognitionVerificationRequest,
  CognitionWorkspaceRequest,
} from "../../../core/types.js";
import type {
  EffectProposal,
  EffectReceipt,
  Observation,
  ObservationRequest,
} from "../types.js";
import type { OperationalClaimLicense } from "../../sandbox/engineering-types.js";
import { getInFlight } from "../effect/in-flight.js";
import { getConcern } from "../concerns/lineage.js";
import { inspectConcernCurrentness } from "../thought/source-currentness.js";
import { utf8JsonBytes, REQUIRED_OBSERVATION_ITEM_BYTES } from "../thought/projection-allocator/composition-contract.js";
import {
  applyPublicPresenceDecision,
  isAutonomousPublicPresenceProposal,
  PUBLIC_PRESENCE_AUDIENCE,
  PUBLIC_PRESENCE_OPERATION,
  publicPresenceReceipt,
  validatePublicPresenceRequest,
} from "../public-presence.js";
import {
  directProjectInspectionRequest,
  isExactDirectProjectInspectionRequest,
  routeProjectInspectionRequest,
  workerProjectInspectionRequest,
} from "../operation/project-inspection-route.js";
export {
  directProjectInspectionRequest,
  isExactDirectProjectInspectionRequest,
  routeProjectInspectionRequest,
  workerProjectInspectionRequest,
} from "../operation/project-inspection-route.js";

const PROJECT_OPERATIONS = new Set([
  "project.read_file",
  "project.list_directory",
  "project.search_text",
]);
const PROJECT_INSPECTION_INTENT = "project.inspect";
const CONCERN_INSPECTION_INTENT = "concern.inspect";

const WORKSPACE_OPERATIONS = new Set([
  "workspace.read_file",
  "workspace.list_directory",
  "workspace.search_text",
  "workspace.write_file",
  "workspace.replace_file",
  "workspace.edit_text",
  "workspace.delete_file",
  "workspace.create_directory",
]);

type LiveSandboxOverrides = Partial<SandboxV2Environment> & {
  sandboxEngineeringLifecycleEnabled?: boolean;
  substrateAvailable?: boolean;
};

type LiveOperationAdapters = {
  executeProjectInspectionV2: typeof executeProjectInspectionV2;
  executeWorkspaceExperimentV2: typeof executeWorkspaceExperimentV2;
  executeCandidateVerificationV2: typeof executeCandidateVerificationV2;
  executeCandidateAuthorshipV2: typeof executeCandidateAuthorshipV2;
  executeInquiryExperimentV2: typeof executeInquiryExperimentV2;
  executePatchExportV2: typeof executePatchExportV2;
  executeModeBWorker: typeof executeModeBWorker;
};

export type V021LiveOperationExecutorOptions = {
  nuclear: DatabaseSync;
  sidecar?: DatabaseSync;
  ownerId?: string;
  nowMs?: () => number;
  registry?: V2ProjectReadRegistry;
  workspaceManager?: WorkspaceManager;
  dispatcher?: SandboxV2Dispatcher;
  envOverrides?: LiveSandboxOverrides;
  /** Test-only seams that still call the approved adapter contract. */
  adapters?: Partial<LiveOperationAdapters>;
};

export type V021LiveOperationExecutors = {
  executeObservation(req: ObservationRequest): Promise<Observation>;
  executeEffect(proposal: EffectProposal): Promise<EffectReceipt>;
  /**
   * Raw Mode-B investigate execution for detached dispatch. Returns the
   * worker result unwrapped (no Observation envelope): the detached
   * dispatcher owns start proof, evidence persistence, and terminal truth.
   */
  runDetachedInvestigate(input: {
    request: unknown;
    cycleId: string;
    purpose: string;
    deadlineAtMs?: number;
  }): Promise<ModeBWorkerResult>;
  /** Whether a Thought-authored investigate may detach right now. */
  canOfferDetachedInvestigate(): boolean;
  /** Direct V2 is narrower than the semantic project.inspect capability. */
  canOfferDirectProjectInspection(): boolean;
  /** Capacity-only preflight used before a detached worker start. */
  probeDetachedInvestigate(): {
    available: true;
  } | {
    available: false;
    reason: string;
    nextProbeAtMs?: number | null;
    terminal?: boolean;
  };
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requestRecord(value: unknown): RecordValue | null {
  return isRecord(value) ? value : null;
}

function operationBase(nowMs: () => number): number {
  return Math.max(Date.now(), nowMs());
}

function inspectionDeadlines(nowMs: () => number): {
  projectInspectionPreparationDeadlineAtMs: number;
  childExecutionDeadlineAtMs: number;
  childTerminationDeadlineAtMs: number;
  settlementDeadlineAtMs: number;
} {
  const base = operationBase(nowMs);
  return {
    projectInspectionPreparationDeadlineAtMs: base + 5_000,
    childExecutionDeadlineAtMs: base + 30_000,
    childTerminationDeadlineAtMs: base + 45_000,
    settlementDeadlineAtMs: base + 60_000,
  };
}

function normalizeProjectRequest(req: ObservationRequest): CognitionInspectionRequest | null {
  const value = requestRecord(req.request);
  const projectId = stringValue(value?.projectId);
  if (!projectId) return null;

  if (req.kind === PROJECT_INSPECTION_INTENT) {
    const exact = directProjectInspectionRequest(value);
    if (exact) return exact;
  }

  const operation = req.kind === PROJECT_INSPECTION_INTENT
    ? stringValue(value?.operation)
    : req.kind;
  if (!operation || !PROJECT_OPERATIONS.has(operation)) return null;

  if (operation === "project.search_text") {
    const pattern = stringValue(value?.pattern);
    if (!pattern) return null;
    return {
      operation,
      projectId,
      ...(typeof value?.path === "string" ? { path: value.path } : {}),
      pattern,
      ...(typeof value?.maxMatches === "number" ? { maxMatches: value.maxMatches } : {}),
    };
  }

  const path = stringValue(value?.path);
  if (!path) return null;
  return { operation, projectId, path };
}

function normalizeWorkspaceRequest(
  proposal: EffectProposal,
  operation: string,
): CognitionWorkspaceRequest | null {
  if (!WORKSPACE_OPERATIONS.has(operation)) return null;
  const value = requestRecord(proposal.request);
  const projectId = stringValue(value?.projectId);
  if (!projectId) return null;
  return {
    ...value,
    operation,
    projectId,
  } as unknown as CognitionWorkspaceRequest;
}

function normalizeVerificationRequest(proposal: EffectProposal): CognitionVerificationRequest | null {
  const value = requestRecord(proposal.request);
  const projectId = stringValue(value?.projectId);
  if (!projectId) return null;
  return {
    operation: "workspace.verify",
    projectId,
    ...(typeof value?.workspaceId === "string" ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value?.recipeId === "string" ? { recipeId: value.recipeId } : {}),
  };
}

function normalizeAuthorshipRequest(proposal: EffectProposal): CognitionAuthorshipRequest | null {
  const value = requestRecord(proposal.request);
  const projectId = stringValue(value?.projectId);
  const objective = stringValue(value?.objective);
  const rationale = stringValue(value?.rationale);
  const riskClass = value?.riskClass;
  if (
    !projectId ||
    !objective ||
    !rationale ||
    (riskClass !== "low" && riskClass !== "medium" && riskClass !== "high" && riskClass !== "consultation")
  ) return null;
  return {
    operation: "changeset.author",
    projectId,
    objective,
    rationale,
    riskClass,
    ...(typeof value?.workspaceId === "string" ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value?.targetArea === "string" ? { targetArea: value.targetArea } : {}),
    ...(typeof value?.expectedEffect === "string" ? { expectedEffect: value.expectedEffect } : {}),
    ...(Array.isArray(value?.evidenceRefs) ? { evidenceRefs: value.evidenceRefs.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value?.verificationRecipeIds) ? { verificationRecipeIds: value.verificationRecipeIds.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(value?.intendedPaths) ? { intendedPaths: value.intendedPaths.filter((item): item is string => typeof item === "string") } : {}),
  };
}

function normalizeInquiryRequest(proposal: EffectProposal): InquiryExperimentRequest | null {
  const value = requestRecord(proposal.request);
  if (
    !value ||
    value.operation !== "objective.operate" ||
    !stringValue(value.projectId) ||
    !stringValue(value.experimentId) ||
    !stringValue(value.objective) ||
    !Array.isArray(value.steps) ||
    !isRecord(value.budget)
  ) return null;
  return value as unknown as InquiryExperimentRequest;
}

function normalizePatchExportRequest(proposal: EffectProposal): CognitionPatchExportRequest | null {
  const value = requestRecord(proposal.request);
  const projectId = stringValue(value?.projectId);
  const changesetId = stringValue(value?.changesetId);
  if (!projectId || !changesetId || value?.adjudication !== "accept") return null;
  return {
    operation: "patch_export",
    projectId,
    changesetId,
    adjudication: "accept",
  };
}

type ConcernInspectPayload =
  | { concernId: string; result: "missing" }
  | { concernId: string; result: "current"; statement: string; statementTruncated: boolean; originalStatementBytes?: number }
  | { concernId: string; result: "stale"; currentStatus: string; statement: string; statementTruncated: boolean; originalStatementBytes?: number };

function executeConcernInspection(
  req: ObservationRequest,
  sidecar: DatabaseSync | undefined,
): Observation {
  if (!sidecar) throw new Error("observation_unavailable");
  const binding = req.concernInspectionBinding;
  const concernRef = stringValue(requestRecord(req.request)?.concernRef);
  if (!binding || !concernRef || binding.concernId !== concernRef) throw new Error("observation_unavailable");
  const row = getConcern(sidecar, binding.concernId);
  if (!row) {
    const missing = concernInspectionObservation(req, { concernId: binding.concernId, result: "missing" });
    if (utf8JsonBytes(missing) > REQUIRED_OBSERVATION_ITEM_BYTES) {
      throw new Error("observation_unavailable");
    }
    return missing;
  }
  const currentness = inspectConcernCurrentness(sidecar, binding.concernId, {
    snapshotHash: binding.expectedSnapshotHash,
    status: binding.expectedStatus,
  });
  const statement = row.statement;
  if (currentness.matches) {
    return projectConcernInspection(req, {
      concernId: binding.concernId,
      result: "current",
      statement,
      statementTruncated: false,
    });
  }
  return projectConcernInspection(req, {
    concernId: binding.concernId,
    result: "stale",
    currentStatus: currentness.currentStatus ?? row.status,
    statement,
    statementTruncated: false,
  });
}

function concernInspectionObservation(req: ObservationRequest, payload: ConcernInspectPayload): Observation {
  return {
    observationId: `v021:observation:${req.requestId}`,
    cycleId: req.cycleId,
    generation: req.generation,
    derived: false,
    replaySafe: true,
    modality: "tool",
    payload,
    provenance: "sidecar:concern.inspect",
    dataClassification: "never_public",
    secretOmitted: false,
  };
}

function projectConcernInspection(
  req: ObservationRequest,
  payload: Exclude<ConcernInspectPayload, { result: "missing" }>,
): Observation {
  const fullBytes = Buffer.byteLength(payload.statement, "utf8");
  const probe = (statement: string, truncated: boolean): number =>
    utf8JsonBytes(concernInspectionObservation(req, {
      ...payload,
      statement,
      statementTruncated: truncated,
      ...(truncated ? { originalStatementBytes: fullBytes } : {}),
    }));
  if (probe(payload.statement, false) <= REQUIRED_OBSERVATION_ITEM_BYTES) {
    return concernInspectionObservation(req, payload);
  }
  if (probe("", true) > REQUIRED_OBSERVATION_ITEM_BYTES) {
    throw new Error("observation_unavailable");
  }
  const chars = [...payload.statement];
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (probe(chars.slice(0, mid).join(""), true) <= REQUIRED_OBSERVATION_ITEM_BYTES) low = mid;
    else high = mid - 1;
  }
  const statement = chars.slice(0, low).join("");
  if (probe(statement, true) > REQUIRED_OBSERVATION_ITEM_BYTES) {
    throw new Error("observation_unavailable");
  }
  return concernInspectionObservation(req, {
    ...payload,
    statement,
    statementTruncated: true,
    originalStatementBytes: fullBytes,
  });
}

function licenseClaims(license: OperationalClaimLicense): Record<string, unknown> {
  return {
    state: license.state,
    ...(license.profile ? { profile: license.profile } : {}),
    ...(license.taskId ? { taskId: license.taskId } : {}),
    ...(license.error ? { error: license.error } : {}),
    ...(license.executionTruth ? { executionTruth: license.executionTruth } : {}),
    ...(license.receiptRef ? { receiptRef: license.receiptRef } : {}),
    ...(license.effectEvidence ? { effectEvidence: license.effectEvidence } : {}),
    ...(license.workspaceClaimEffect ? { workspaceClaimEffect: license.workspaceClaimEffect } : {}),
    ...(license.verificationClaimEffect ? { verificationClaimEffect: license.verificationClaimEffect } : {}),
    ...(license.authorshipClaimEffect ? { authorshipClaimEffect: license.authorshipClaimEffect } : {}),
    ...(license.patchExportClaimEffect ? { patchExportClaimEffect: license.patchExportClaimEffect } : {}),
  };
}

function inferDispatchEvidence(
  license: OperationalClaimLicense,
  proposal: EffectProposal,
  db?: DatabaseSync,
): { provenNotStarted: boolean } {
  if (
    license.error === "invalid_request" ||
    license.error === "unsupported_operation" ||
    license.error === "missing_project" ||
    license.error === "missing_path" ||
    license.error === "thought_adjudication_required" ||
    license.error === "verification_receipt_required" ||
    license.error === "inquiry_workspace_forbidden" ||
    license.error === "patch_export_gate_denied" ||
    license.error === "patch_export_not_allowed" ||
    license.error === "changeset_missing" ||
    license.error === "changeset_not_exportable" ||
    license.error === "changeset_project_mismatch" ||
    license.error === "worker_disabled" ||
    license.error === "worker_capacity_exhausted" ||
    license.error === "capacity_unproven" ||
    license.error === "unavailable" ||
    license.error === "forbidden_field" ||
    license.error === "unknown_field" ||
    license.error === "missing_project" ||
    license.error === "missing_workspace" ||
    license.error === "opencode_pin_mismatch" ||
    license.error === "worker_gate_denied" ||
    license.error === "opencode_binary_missing" ||
    license.error === "native_tool_forbidden" ||
    license.error === "opencode_provider_rejected"
  ) {
    return { provenNotStarted: true };
  }
  if (license.error === "effect_unavailable") {
    return { provenNotStarted: false };
  }
  if (db) {
    try {
      const inFlight = getInFlight(db, proposal.effectId) ?? getInFlight(db, proposal.idempotencyKey);
      if (inFlight?.status === "in_flight" || inFlight?.originAttemptId) {
        return { provenNotStarted: false };
      }
    } catch {
      // ignore
    }
  }
  return { provenNotStarted: false };
}

function determineReceiptOutcome(
  license: OperationalClaimLicense,
  proposal: EffectProposal,
  db?: DatabaseSync,
): EffectReceipt["outcome"] {
  switch (license.state) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "running":
      return "in_progress";
    case "outcome_unknown":
      return "outcome_unknown";
    case "proposed":
    case "admitted":
      return "not_attempted";
    case "none": {
      const evidence = inferDispatchEvidence(license, proposal, db);
      return evidence.provenNotStarted ? "not_attempted" : "outcome_unknown";
    }
    default: {
      const exhaustive: never = license.state;
      return exhaustive;
    }
  }
}

function receiptFromLicense(
  proposal: EffectProposal,
  license: OperationalClaimLicense,
  nowMs: () => number,
  db?: DatabaseSync,
): EffectReceipt {
  const outcome = determineReceiptOutcome(license, proposal, db);
  return {
    receiptId: `v021:effect:${proposal.effectId}`,
    effectId: proposal.effectId,
    idempotencyKey: proposal.idempotencyKey,
    outcome,
    claims: licenseClaims(license),
    atMs: nowMs(),
    dataClassification: "never_public",
    secretOmitted: true,
  };
}

function unavailableLicense(profile: string, error: string): OperationalClaimLicense {
  return { state: "none", profile, error, executionTruth: "no_effect_proven" };
}

function resultLicense(
  result:
    | ExecuteWorkspaceExperimentV2Result
    | ExecuteCandidateVerificationV2Result
    | ExecuteCandidateAuthorshipV2Result
    | ExecutePatchExportV2Result,
): OperationalClaimLicense {
  return result.license;
}

function inquiryResultLicense(
  result: ExecuteInquiryExperimentV2Result,
  taskId: string,
  messageEntityUuid: string,
): OperationalClaimLicense {
  const workspaceStep = [...result.stepResults].reverse().find((step) => step.license.workspaceClaimEffect);
  const verificationStep = [...result.stepResults].reverse().find((step) => step.license.verificationClaimEffect);
  return {
    state: result.state,
    taskId,
    profile: "inquiry_experiment",
    ...(result.error ? { error: result.error } : {}),
    ...(result.state === "succeeded"
      ? { executionTruth: "effect_verified" as const }
      : result.state === "outcome_unknown"
        ? { executionTruth: "effect_indeterminate" as const }
        : {}),
    ...(workspaceStep?.license.workspaceClaimEffect
      ? { workspaceClaimEffect: workspaceStep.license.workspaceClaimEffect }
      : {}),
    ...(verificationStep?.license.verificationClaimEffect
      ? { verificationClaimEffect: verificationStep.license.verificationClaimEffect }
      : {}),
    sourceMessageEntityUuid: messageEntityUuid,
  };
}

export function createV021LiveOperationExecutors(
  options: V021LiveOperationExecutorOptions,
): V021LiveOperationExecutors {
  const nowMs = options.nowMs ?? (() => Date.now());
  const registry = options.registry ?? options.envOverrides?.registry ?? loadOperatorProjectReadRegistry();
  const adapters: LiveOperationAdapters = {
    executeProjectInspectionV2,
    executeWorkspaceExperimentV2,
    executeCandidateVerificationV2,
    executeCandidateAuthorshipV2,
    executeInquiryExperimentV2,
    executePatchExportV2,
    executeModeBWorker,
    ...options.adapters,
  };

  const common = {
    registry,
    dispatcher: options.dispatcher,
    envOverrides: options.envOverrides,
    db: options.nuclear,
    masterMode: env.cognitionMode,
    workspaceManager: options.workspaceManager,
  };

  async function runModeB(
    kind: typeof MODE_B_INVESTIGATE | typeof MODE_B_DEVELOP,
    request: unknown,
    cycleId: string,
    purpose: string,
    workspaceId?: string,
    deadlineAtMs?: number,
  ): Promise<ModeBWorkerResult> {
    const catalog = {
      ...C1_OPENCODE_FREE_CATALOG,
      candidateDevelopAllowsNvidia: env.opencodeCandidateDevelopAllowsNvidia,
    };
    const quotaState = loadQuotaState(env.opencodeQuotaStatePath);
    const router = createQuotaRouter({ catalog, state: quotaState, nowMs: nowMs() });
    const base = operationBase(nowMs);
    const sessionDeadlineAtMs = (deadlineAtMs ?? (base + DETACHED_WORKER_MAX_WALL_CLOCK_MS)) - WORKER_FINALIZATION_RESERVE_MS;
    const sandboxGate = {
      registry,
      masterMode: env.cognitionMode,
      lifecycleEnabled: options.envOverrides?.sandboxEngineeringLifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled,
      substrateAvailable: options.envOverrides?.substrateAvailable,
    };
    const gateOk = options.adapters?.executeModeBWorker
      ? true
      : kind === MODE_B_INVESTIGATE
        ? canOfferWorkerBackedProjectInspection(sandboxGate)
        : canOfferCandidateWorkspace(options.nuclear, sandboxGate);
    return adapters.executeModeBWorker({
      kind,
      request,
      purpose,
      isolationRoot: env.opencodeHomeDir,
      binaryPath: env.opencodeBinaryPath,
      pinnedVersion: env.opencodePinnedVersion,
      quotaPath: env.opencodeQuotaStatePath,
      router,
      persistQuota: (state) => saveQuotaState(env.opencodeQuotaStatePath, state),
      dispatchers: {
        executeProjectInspectionV2: adapters.executeProjectInspectionV2,
        executeWorkspaceExperimentV2: adapters.executeWorkspaceExperimentV2,
      },
      inspectionBase: {
        ...common,
        ...inspectionDeadlines(nowMs),
        messageEntityUuid: cycleId,
      },
      workspaceBase: {
        ...common,
        deadlineAtMs: sessionDeadlineAtMs,
        childExecutionDeadlineAtMs: Math.min(sessionDeadlineAtMs, base + 30_000),
        childTerminationDeadlineAtMs: Math.min(sessionDeadlineAtMs, base + 45_000),
        settlementDeadlineAtMs: sessionDeadlineAtMs,
        messageEntityUuid: cycleId,
      },
      workspaceId,
      pathEnv: process.env.PATH ?? "",
      nowMs,
      deadlineAtMs: sessionDeadlineAtMs,
      workerEnabled: env.opencodeWorkerEnabled,
      gateOk,
      gateError: gateOk ? undefined : "worker_gate_denied",
    });
  }

  return {
    canOfferDetachedInvestigate(): boolean {
      if (options.adapters?.executeModeBWorker) return true;
      if (env.opencodeWorkerEnabled !== true) return false;
      if (resolveOpenCodeBinary(env.opencodeBinaryPath) == null) return false;
      return canOfferWorkerBackedProjectInspection({
        registry,
        masterMode: env.cognitionMode,
        lifecycleEnabled: options.envOverrides?.sandboxEngineeringLifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled,
        substrateAvailable: options.envOverrides?.substrateAvailable,
      });
    },

    canOfferDirectProjectInspection(): boolean {
      return canOfferProjectInspection(options.nuclear, {
        registry,
        masterMode: env.cognitionMode,
        lifecycleEnabled: options.envOverrides?.sandboxEngineeringLifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled,
        substrateAvailable: options.envOverrides?.substrateAvailable,
      });
    },

    probeDetachedInvestigate() {
      if (options.adapters?.executeModeBWorker) return { available: true as const };
      const gate = {
        registry,
        masterMode: env.cognitionMode,
        lifecycleEnabled: options.envOverrides?.sandboxEngineeringLifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled,
        substrateAvailable: options.envOverrides?.substrateAvailable,
      };
      if (env.opencodeWorkerEnabled !== true || resolveOpenCodeBinary(env.opencodeBinaryPath) == null) {
        return { available: false as const, reason: "worker_unavailable", terminal: true as const };
      }
      if (!canOfferWorkerBackedProjectInspection(gate)) {
        return { available: false as const, reason: "worker_gate_denied", terminal: true as const };
      }
      const router = createQuotaRouter({
        catalog: {
          ...C1_OPENCODE_FREE_CATALOG,
          candidateDevelopAllowsNvidia: env.opencodeCandidateDevelopAllowsNvidia,
        },
        state: loadQuotaState(env.opencodeQuotaStatePath),
        nowMs: nowMs(),
      });
      const decision = routeWorkerTask(router, "delegated_read");
      if (decision.ok) return { available: true as const };
      return {
        available: false as const,
        reason: decision.reason,
        ...(decision.nextProbeAtMs == null ? {} : { nextProbeAtMs: decision.nextProbeAtMs }),
      };
    },

    async runDetachedInvestigate(input: {
      request: unknown;
      cycleId: string;
      purpose: string;
      deadlineAtMs?: number;
    }): Promise<ModeBWorkerResult> {
      return runModeB(MODE_B_INVESTIGATE, input.request, input.cycleId, input.purpose, undefined, input.deadlineAtMs);
    },

    async executeObservation(req): Promise<Observation> {
      if (req.kind === CONCERN_INSPECTION_INTENT) {
        return executeConcernInspection(req, options.sidecar);
      }
      if (req.kind === MODE_B_INVESTIGATE) {
        let result: ModeBWorkerResult;
        try {
          result = await runModeB(req.kind, req.request, req.cycleId, "investigate");
        } catch {
          throw new Error("observation_unavailable");
        }
        return {
          observationId: `v021:observation:${req.requestId}`,
          cycleId: req.cycleId,
          generation: req.generation,
          derived: false,
          replaySafe: true,
          modality: "tool",
          payload: result.payload,
          provenance: "worker:project.investigate",
          dataClassification: "never_public",
          secretOmitted: true,
        };
      }
      const request = normalizeProjectRequest(req);
      if (!request) throw new Error("observation_unavailable");
      let result: ExecuteProjectInspectionV2Result;
      try {
        result = await adapters.executeProjectInspectionV2({
          ...common,
          ...inspectionDeadlines(nowMs),
          request,
          messageEntityUuid: req.cycleId,
        });
      } catch {
        throw new Error("observation_unavailable");
      }
      if (
        result.license.state !== "succeeded" ||
        result.observation === null ||
        result.observation.projectId !== request.projectId ||
        result.observation.operation !== request.operation
      ) throw new Error("observation_unavailable");
      return {
        observationId: `v021:observation:${req.requestId}`,
        cycleId: req.cycleId,
        generation: req.generation,
        derived: false,
        replaySafe: true,
        modality: "tool",
        payload: result.observation,
        provenance: "sandbox-v2:project-inspection",
        dataClassification: "never_public",
        secretOmitted: false,
      };
    },

    async executeEffect(proposal): Promise<EffectReceipt> {
      const operation = (() => {
        if (proposal.kind === "candidate_workspace_experiment") {
          const value = requestRecord(proposal.request);
          return typeof value?.operation === "string" ? value.operation : "";
        }
        if (proposal.kind === "candidate_verification") return "workspace.verify";
        if (proposal.kind === "candidate_authorship") return "changeset.author";
        return proposal.kind;
      })();

      if (proposal.kind === PUBLIC_PRESENCE_OPERATION && operation === PUBLIC_PRESENCE_OPERATION) {
        const atMs = nowMs();
        const validation = validatePublicPresenceRequest(proposal.request);
        if (!validation.ok) {
          return publicPresenceReceipt(proposal, {
            outcome: "failed",
            claims: { state: "none", error: validation.code, audience: PUBLIC_PRESENCE_AUDIENCE },
            atMs,
          });
        }
        if (
          !options.sidecar
          || !options.ownerId
          || !isAutonomousPublicPresenceProposal(options.sidecar, proposal, options.ownerId)
        ) {
          return publicPresenceReceipt(proposal, {
            outcome: "failed",
            claims: { state: "none", error: "non_autonomous_lineage", audience: PUBLIC_PRESENCE_AUDIENCE },
            atMs,
          });
        }
        try {
          const state = applyPublicPresenceDecision({
            db: options.sidecar,
            decision: validation.decision,
            cycleId: proposal.cycleId,
            generation: proposal.generation,
            effectId: proposal.effectId,
            authoredAtMs: atMs,
          });
          return publicPresenceReceipt(proposal, {
            outcome: "succeeded",
            claims: {
              state: "persisted",
              decision: state.action,
              audience: PUBLIC_PRESENCE_AUDIENCE,
              ...(state.text === null ? {} : { text: state.text }),
              authoredAtMs: state.authoredAtMs,
              expiresAtMs: state.expiresAtMs,
              stateRevision: state.stateRevision,
              projectionState: state.projectionState,
            },
            atMs,
          });
        } catch {
          return publicPresenceReceipt(proposal, {
            outcome: "failed",
            claims: { state: "none", error: "state_persistence_failed", audience: PUBLIC_PRESENCE_AUDIENCE },
            atMs,
          });
        }
      }

      let license: OperationalClaimLicense;
      let modeBResult: ModeBWorkerResult | null = null;
      try {
        if (operation === "objective.operate") {
          const request = normalizeInquiryRequest(proposal);
          if (!request) license = unavailableLicense("inquiry_experiment", "invalid_request");
          else {
            const result = await adapters.executeInquiryExperimentV2({
              ...common,
              request,
              ownerId: options.ownerId,
              taskId: proposal.effectId,
              messageEntityUuid: proposal.cycleId,
            });
            license = inquiryResultLicense(result, proposal.effectId, proposal.cycleId);
          }
        } else if (WORKSPACE_OPERATIONS.has(operation)) {
          const request = normalizeWorkspaceRequest(proposal, operation);
          if (!request) license = unavailableLicense("project_experimentation", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const result = await adapters.executeWorkspaceExperimentV2({
              ...common,
              request,
              taskId: proposal.effectId,
              messageEntityUuid: proposal.cycleId,
              deadlineAtMs: base + 60_000,
              childExecutionDeadlineAtMs: base + 30_000,
              childTerminationDeadlineAtMs: base + 45_000,
              settlementDeadlineAtMs: base + 60_000,
            });
            license = resultLicense(result);
          }
        } else if (operation === "workspace.verify") {
          const request = normalizeVerificationRequest(proposal);
          if (!request) license = unavailableLicense("candidate_verification", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const result = await adapters.executeCandidateVerificationV2({
              ...common,
              request: {
                projectId: request.projectId,
                workspaceId: request.workspaceId,
                recipeId: request.recipeId,
              },
              taskId: proposal.effectId,
              ownerId: options.ownerId,
              messageEntityUuid: proposal.cycleId,
              deadlineAtMs: base + 60_000,
            });
            license = resultLicense(result);
          }
        } else if (operation === "changeset.author") {
          const request = normalizeAuthorshipRequest(proposal);
          if (!request) license = unavailableLicense("candidate_authorship", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const result = await adapters.executeCandidateAuthorshipV2({
              ...common,
              request,
              taskId: proposal.effectId,
              ownerId: options.ownerId,
              messageEntityUuid: proposal.cycleId,
              deadlineAtMs: base + 60_000,
            });
            license = resultLicense(result);
          }
        } else if (operation === MODE_B_DEVELOP) {
          try {
            const value = requestRecord(proposal.request);
            const result = await runModeB(
              MODE_B_DEVELOP,
              proposal.request,
              proposal.cycleId,
              "develop",
              stringValue(value?.workspaceId) ?? undefined,
            );
            modeBResult = result;
            license = {
              ...result.license,
              taskId: proposal.effectId,
              sourceMessageEntityUuid: proposal.cycleId,
            };
          } catch {
            license = unavailableLicense("opencode_mode_b", "effect_unavailable");
          }
        } else if (operation === "patch_export") {
          const request = normalizePatchExportRequest(proposal);
          if (!request) license = unavailableLicense("patch_export", "invalid_request");
          else if (!options.ownerId) license = unavailableLicense("patch_export", "owner_id_required");
          else {
            const result = await adapters.executePatchExportV2({
              ...common,
              request,
              ownerId: options.ownerId,
              messageEntityUuid: proposal.cycleId,
            });
            license = resultLicense(result);
          }
        } else {
          license = unavailableLicense("cognitive_effect", "unsupported_operation");
        }
      } catch {
        license = unavailableLicense("cognitive_effect", "effect_unavailable");
      }
      const receipt = receiptFromLicense(proposal, license, nowMs, options.sidecar);
      if (!modeBResult) return receipt;
      return {
        ...receipt,
        claims: {
          ...receipt.claims,
          selectedModelId: modeBResult.selectedModelId,
          summary: modeBResult.summary,
          steps: modeBResult.payload.steps,
        },
      };
    },
  };
}

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
  commandCodeWorkerReadiness,
  executeCommandCodeWorker,
  MODE_B_DEVELOP,
  MODE_B_INVESTIGATE,
  type CommandCodeWorkerInvocationEvidence,
  type CommandCodeWorkerInput,
  type ModeBWorkerResult,
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  COMMAND_CODE_WORKER_EFFORT,
  COMMAND_CODE_WORKER_PINNED_VERSION,
  WORKER_FINALIZATION_RESERVE_MS,
} from "../../sandbox/worker/command-code-worker.js";
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
  CognitiveStatus,
  EffectProposal,
  EffectReceipt,
  Observation,
  ObservationRequest,
  QuarantineKind,
} from "../types.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION, MAX_EFFECT_ROUNDS } from "../types.js";
import type { EffectExecutionControl } from "../effect/execution-control.js";
import type { OperationalClaimLicense } from "../../sandbox/engineering-types.js";
import { getInFlightByEffectId, getInFlightByIdempotencyKey } from "../effect/in-flight.js";
import { mergeEffectDiagnostic, recordEffectDiagnostic } from "../effect/diagnostics.js";
import { currentBuildIdentity, currentContractId, qualificationCheckoutIdentity } from "../../rollout/capabilities.js";
import { CREDENTIAL_OMITTED_PLACEHOLDER, detectCredentialShape } from "../../privacy/secrets.js";
import { WORKSPACE_WORKER_REQUEST_SCHEMA_ID } from "@composer-assistant/sandbox-v2";
import type { SocialAudience } from "../social/types.js";
import { cognitiveStatusOf, getConcern, quarantineKindOf } from "../concerns/lineage.js";
import { inspectConcernCurrentness } from "../thought/source-currentness.js";
import { projectFileArtifactIdentity } from "../observation/view.js";
import { executeTypedInspection } from "./typed-inspections.js";
import { executeEvidenceOperation, type EvidenceRefreshFetcher } from "./evidence-operations.js";
import { executeWebSearchOperation } from "./search-operations.js";
import { executeWebFetchOperation } from "./web-fetch-operations.js";
import {
  defaultWebSearchProvider,
  WEB_SEARCH_OPERATION_KIND,
  type WebSearchProvider,
} from "../../perception/search-provider.js";
import {
  defaultWebFetchProvider,
  WEB_FETCH_OPERATION_KIND,
  type WebFetchProvider,
} from "../../perception/web-fetch-provider.js";
import {
  CapabilityUnavailableError,
  isEvidenceOperationKind,
  isTypedInspectionOperationKind,
  safeReasonCode,
} from "../thought/typed-inspection.js";
import {
  concernDiscoverCursorOf,
  concernDiscoverLimitOf,
  isConcernDiscoverRequest,
} from "../thought/concern-inspect.js";
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
  refreshEvidence?: EvidenceRefreshFetcher;
  webSearchProvider?: WebSearchProvider;
  webFetchProvider?: WebFetchProvider;
  executeWorkspaceExperimentV2: typeof executeWorkspaceExperimentV2;
  executeCandidateVerificationV2: typeof executeCandidateVerificationV2;
  executeCandidateAuthorshipV2: typeof executeCandidateAuthorshipV2;
  executeInquiryExperimentV2: typeof executeInquiryExperimentV2;
  executePatchExportV2: typeof executePatchExportV2;
  executeModeBWorker: typeof executeCommandCodeWorker;
};

type ModeBWorkerEvidenceBinding = Readonly<{
  kind: CommandCodeWorkerInput["kind"];
  operationId: string | null;
  conversationId: string | null;
  cycleId: string | null;
  generation: number | null;
  wakeId: string | null;
}>;

type ModeBWorkerEvidenceSnapshot = Readonly<{
  license: Readonly<Pick<OperationalClaimLicense, "state" | "error">>;
  selectedModelId: string | null;
  commandCodeInvocations: readonly Readonly<CommandCodeWorkerInvocationEvidence>[];
}>;

export type V021LiveOperationExecutorOptions = {
  nuclear: DatabaseSync;
  sidecar?: DatabaseSync;
  ownerId?: string;
  nowMs?: () => number;
  registry?: V2ProjectReadRegistry;
  workspaceManager?: WorkspaceManager;
  dispatcher?: SandboxV2Dispatcher;
  envOverrides?: LiveSandboxOverrides;
  /** Host-side evidence observer. Receives frozen, non-secret evidence only. */
  onModeBWorkerResult?: (
    input: ModeBWorkerEvidenceBinding,
    result: ModeBWorkerEvidenceSnapshot,
  ) => void;
  /** Test-only seams that still call the approved adapter contract. */
  adapters?: Partial<LiveOperationAdapters>;
};

export type V021LiveOperationExecutors = {
  executeObservation(req: ObservationRequest): Promise<Observation>;
  executeEffect(proposal: EffectProposal, control?: EffectExecutionControl): Promise<EffectReceipt>;
  /**
   * Raw Mode-B investigate execution for detached dispatch. Returns the
   * worker result unwrapped (no Observation envelope): the detached
   * dispatcher owns start proof, evidence persistence, and terminal truth.
   */
  runDetachedInvestigate(input: {
    request: unknown;
    operationId?: string;
    conversationId?: string;
    cycleId: string;
    generation?: number;
    wakeId?: string;
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

/**
 * Concern inspection payload. The read is deliberately qualified: quarantine
 * kind is always present when the concern is quarantined, because ACCESSIBLE is
 * not TRUSTED. A NULL cognitive status is served as NULL rather than coerced
 * into a status cognition never authored, and a forgotten concern is
 * structurally absent (`missing`) rather than redacted-in-place.
 */
type ConcernInspectClass = "quarantined" | "unestablished" | "resolved" | "dormant" | "active_like";

type ConcernDiscoverItem = {
  concernId: string;
  cognitiveStatus: CognitiveStatus | null;
  quarantineKind: QuarantineKind | null;
};

type ConcernInspectPayload =
  | { result: "missing" }
  | {
      concernId: string;
      result: "current" | "stale";
      class: ConcernInspectClass;
      cognitiveStatus: CognitiveStatus | null;
      quarantine: { kind: QuarantineKind } | null;
      statement: string;
      statementTruncated: boolean;
      originalStatementBytes?: number;
    }
  | {
      result: "page" | "cursor_invalid";
      concerns: ConcernDiscoverItem[];
      omittedCount: number;
      nextCursor: string | null;
    };

function concernInspectClass(
  status: CognitiveStatus | null,
  quarantineKind: QuarantineKind | null,
): ConcernInspectClass {
  if (quarantineKind !== null) return "quarantined";
  if (status === null) return "unestablished";
  if (status === "resolved") return "resolved";
  if (status === "dormant_but_revisitable") return "dormant";
  return "active_like";
}

const INSPECTABLE_CONCERN_PREDICATE = `
  forgotten = 0
  AND (cognitive_status IS NULL
    OR cognitive_status IN ('dormant_but_revisitable', 'resolved')
    OR quarantine_kind IS NOT NULL)`;

function executeConcernDiscover(
  req: ObservationRequest,
  sidecar: DatabaseSync,
): Observation {
  const cycleRow = sidecar.prepare(
    "SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
  ).get(req.cycleId) as { conversation_id?: unknown } | undefined;
  const conversationId = typeof cycleRow?.conversation_id === "string" && cycleRow.conversation_id
    ? cycleRow.conversation_id
    : null;
  if (!conversationId) throw new Error("observation_unavailable");

  const limit = concernDiscoverLimitOf(req.request);
  const cursor = concernDiscoverCursorOf(req.request);
  if (cursor !== null) {
    const cursorRow = sidecar.prepare(
      `SELECT 1 AS present
         FROM concerns
        WHERE concern_id = ?
          AND conversation_id = ?
          AND ${INSPECTABLE_CONCERN_PREDICATE}
        LIMIT 1`,
    ).get(cursor, conversationId) as { present?: unknown } | undefined;
    if (!cursorRow) {
      return projectConcernDiscover(req, {
        result: "cursor_invalid",
        concerns: [],
        omittedCount: 0,
        nextCursor: null,
      });
    }
  }

  const rows = sidecar.prepare(
    `SELECT concern_id, cognitive_status, quarantine_kind
       FROM concerns
      WHERE conversation_id = ?
        AND ${INSPECTABLE_CONCERN_PREDICATE}
        ${cursor === null ? "" : "AND concern_id > ?"}
      ORDER BY concern_id ASC
      LIMIT ?`,
  ).all(...(cursor === null ? [conversationId, limit + 1] : [conversationId, cursor, limit + 1])) as Array<{
    concern_id?: unknown;
    cognitive_status?: unknown;
    quarantine_kind?: unknown;
  }>;

  const pageRows = rows.slice(0, limit);
  const toItem = (row: {
    concern_id?: unknown;
    cognitive_status?: unknown;
    quarantine_kind?: unknown;
  }): ConcernDiscoverItem => ({
    concernId: typeof row.concern_id === "string" ? row.concern_id : "",
    cognitiveStatus: cognitiveStatusOf(row.cognitive_status),
    quarantineKind: quarantineKindOf(row.quarantine_kind),
  });

  let fitted: ConcernDiscoverItem[] = [];
  for (let index = 0; index < pageRows.length; index += 1) {
    const candidate = [...fitted, toItem(pageRows[index])];
    const moreInPage = index + 1 < pageRows.length;
    const probe = concernInspectionObservation(req, {
      result: "page",
      concerns: candidate,
      omittedCount: moreInPage ? 1 : 0,
      nextCursor: moreInPage ? candidate[candidate.length - 1]?.concernId ?? null : null,
    });
    if (utf8JsonBytes(probe) > REQUIRED_OBSERVATION_ITEM_BYTES) break;
    fitted = candidate;
  }
  if (fitted.length === 0 && pageRows.length > 0) throw new Error("observation_unavailable");

  let omittedCount = 0;
  if (fitted.length > 0) {
    const lastId = fitted[fitted.length - 1].concernId;
    const remaining = sidecar.prepare(
      `SELECT COUNT(*) AS count
         FROM concerns
        WHERE conversation_id = ?
          AND ${INSPECTABLE_CONCERN_PREDICATE}
          AND concern_id > ?`,
    ).get(conversationId, lastId) as { count?: unknown } | undefined;
    omittedCount = typeof remaining?.count === "number" ? remaining.count : Number(remaining?.count ?? 0) || 0;
  } else if (pageRows.length > 0) {
    omittedCount = pageRows.length;
  }

  let concerns = fitted;
  let nextCursor = omittedCount > 0 && concerns.length > 0
    ? concerns[concerns.length - 1].concernId
    : null;
  while (concerns.length > 0) {
    const probe = concernInspectionObservation(req, {
      result: "page",
      concerns,
      omittedCount,
      nextCursor,
    });
    if (utf8JsonBytes(probe) <= REQUIRED_OBSERVATION_ITEM_BYTES) break;
    concerns = concerns.slice(0, -1);
    nextCursor = omittedCount > 0 && concerns.length > 0
      ? concerns[concerns.length - 1].concernId
      : null;
    omittedCount += 1;
    if (concerns.length === 0) throw new Error("observation_unavailable");
  }

  return projectConcernDiscover(req, {
    result: "page",
    concerns,
    omittedCount,
    nextCursor,
  });
}

function projectConcernDiscover(
  req: ObservationRequest,
  payload: Extract<ConcernInspectPayload, { result: "page" | "cursor_invalid" }>,
): Observation {
  const observation = concernInspectionObservation(req, payload);
  if (utf8JsonBytes(observation) > REQUIRED_OBSERVATION_ITEM_BYTES) {
    throw new Error("observation_unavailable");
  }
  return observation;
}

function executeConcernInspection(
  req: ObservationRequest,
  sidecar: DatabaseSync | undefined,
): Observation {
  if (!sidecar) throw new Error("observation_unavailable");
  if (isConcernDiscoverRequest(req.request)) {
    return executeConcernDiscover(req, sidecar);
  }
  const binding = req.concernInspectionBinding;
  const concernRef = stringValue(requestRecord(req.request)?.concernRef);
  if (!binding || !concernRef || binding.concernId !== concernRef) throw new Error("observation_unavailable");
  const row = getConcern(sidecar, binding.concernId);
  if (!row) {
    const missing = concernInspectionObservation(req, { result: "missing" });
    if (utf8JsonBytes(missing) > REQUIRED_OBSERVATION_ITEM_BYTES) {
      throw new Error("observation_unavailable");
    }
    return missing;
  }
  const currentness = inspectConcernCurrentness(sidecar, binding.concernId, {
    snapshotHash: binding.expectedSnapshotHash,
    status: binding.expectedStatus,
    quarantineKind: binding.expectedQuarantineKind ?? null,
  });
  const statement = row.statement;
  const qualification = {
    class: concernInspectClass(row.status, currentness.currentQuarantineKind),
    cognitiveStatus: row.status,
    quarantine: currentness.currentQuarantineKind === null
      ? null
      : { kind: currentness.currentQuarantineKind },
  };
  if (currentness.matches) {
    return projectConcernInspection(req, {
      concernId: binding.concernId,
      result: "current",
      ...qualification,
      statement,
      statementTruncated: false,
    });
  }
  return projectConcernInspection(req, {
    concernId: binding.concernId,
    result: "stale",
    ...qualification,
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
  payload: Extract<ConcernInspectPayload, { concernId: string; result: "current" | "stale" }>,
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
    ...(license.terminationClass ? { terminationClass: license.terminationClass } : {}),
    ...(license.fieldErrors ? { fieldErrors: license.fieldErrors } : {}),
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
    license.error === "command_code_pin_mismatch" ||
    license.error === "command_code_version_mismatch" ||
    license.error === "command_code_credentials_missing" ||
    license.error === "worker_gate_denied" ||
    license.error === "command_code_cli_unavailable" ||
    license.error === "worker_isolation_unavailable" ||
    license.error === "native_tool_forbidden" ||
    license.error === "external_service_rejected" ||
    license.error === "external_service_limited" ||
    license.error === "external_service_unavailable"
  ) {
    return { provenNotStarted: true };
  }
  if (license.error === "effect_unavailable") {
    return { provenNotStarted: false };
  }
  if (db) {
    try {
      const inFlight = getInFlightByEffectId(db, proposal.effectId)
        ?? getInFlightByIdempotencyKey(db, proposal.idempotencyKey);
      if (inFlight) {
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

function persistModeBEffectDiagnostic(
  proposal: EffectProposal,
  result: ModeBWorkerResult,
  db: DatabaseSync | undefined,
  atMs: number,
): string | null {
  if (!db || !result.diagnostics) return null;
  const cycle = db.prepare("SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1")
    .get(proposal.cycleId) as RecordValue | undefined;
  const inFlight = getInFlightByEffectId(db, proposal.effectId);
  const conversationId = stringValue(cycle?.conversation_id);
  const audienceScope = inFlight?.audienceScope ?? null;
  if (!conversationId || !audienceScope || inFlight?.cycleId !== proposal.cycleId) return null;

  const request = requestRecord(proposal.request);
  const focus = stringValue(request?.focus);
  const safeFocus = focus
    ? detectCredentialShape(focus).hit ? CREDENTIAL_OMITTED_PLACEHOLDER : focus.slice(0, 1024)
    : null;
  const rawBuildIdentity = currentBuildIdentity();
  const artifactGitSha = qualificationCheckoutIdentity();
  const releaseId = env.ashleyReleaseId.trim();
  const diagnostics = result.diagnostics;
  const diagnostic = {
    release: {
      currentBuildIdentity: detectCredentialShape(rawBuildIdentity).hit ? CREDENTIAL_OMITTED_PLACEHOLDER : rawBuildIdentity,
      currentBuildIdentitySource: releaseId ? "ASHLEY_RELEASE_ID" : "git_fallback",
      artifactGitSha,
      artifactTreeSha: null,
      releaseIdentityConflict: rawBuildIdentity !== artifactGitSha,
      contractId: currentContractId(),
      sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      toolContractVersion: WORKSPACE_WORKER_REQUEST_SCHEMA_ID,
    },
    invocation: {
      modelId: result.selectedModelId ?? result.commandCodeInvocations[0]?.configuredModelId ?? null,
      effort: result.commandCodeInvocations[0]?.effort ?? COMMAND_CODE_WORKER_EFFORT,
      pin: result.commandCodeInvocations[0]?.cliVersion ?? COMMAND_CODE_WORKER_PINNED_VERSION,
      maxStepsRequested: diagnostics.maxStepsRequested,
      maxStepsUsed: diagnostics.maxStepsUsed,
      terminationClass: diagnostics.terminationClass,
    },
    delegation: {
      projectId: request?.projectId && !detectCredentialShape(String(request.projectId)).hit
        ? String(request.projectId).slice(0, 256)
        : request?.projectId ? CREDENTIAL_OMITTED_PLACEHOLDER : null,
      focus: safeFocus,
      authorityRevision: proposal.authorityEpoch,
      deadlineAtMs: diagnostics.deadlineAtMs,
    },
    toolRequests: diagnostics.toolRequests,
    validationStage: diagnostics.validationStage,
    execution: {
      started: diagnostics.toolRequests.some((tool) => tool.executionStarted),
      effectTruth: result.license.executionTruth ?? "unknown",
    },
    completionBindingId: proposal.effectId,
    ...(diagnostics.malformedWorkerOutput ? { malformedWorkerOutput: diagnostics.malformedWorkerOutput } : {}),
  };
  const row = recordEffectDiagnostic(db, {
    effectId: proposal.effectId,
    conversationId,
    cycleId: proposal.cycleId,
    generation: proposal.generation,
    audienceScope: audienceScope as SocialAudience,
    dataClassification: "never_public",
    secretOmitted: true,
    diagnostic,
    atMs,
  });
  mergeEffectDiagnostic(db, proposal.effectId, diagnostic);
  return row.diagnosticId;
}

function receiptContinuationClaims(input: {
  proposal: EffectProposal;
  license: OperationalClaimLicense;
  modeBResult: ModeBWorkerResult | null;
  steps?: readonly RecordValue[];
  db?: DatabaseSync;
}): Record<string, unknown> {
  const request = requestRecord(input.proposal.request);
  const delegatedPurpose = stringValue(request?.delegatedPurpose) ?? stringValue(request?.purpose);
  let remainingEffectRounds: number | null = null;
  if (input.db) {
    try {
      const row = input.db.prepare(
        `SELECT effect_rounds FROM thought_attempt_counters
          WHERE cycle_id = ? AND generation = ? LIMIT 1`,
      ).get(input.proposal.cycleId, input.proposal.generation) as RecordValue | undefined;
      const used = typeof row?.effect_rounds === "number" ? row.effect_rounds : Number(row?.effect_rounds);
      if (Number.isSafeInteger(used) && used >= 0) {
        remainingEffectRounds = Math.max(0, MAX_EFFECT_ROUNDS - used);
      }
    } catch {
      remainingEffectRounds = null;
    }
  }

  const sourceSteps = input.modeBResult && Array.isArray(input.modeBResult.payload.steps)
    ? input.modeBResult.payload.steps.filter(isRecord)
    : input.steps ?? [];
  const steps: RecordValue[] = [];
  const knownHashes: Array<{ step: number | null; beforeSha256?: string; afterSha256?: string }> = [];
  const unknownRemainder: Array<{ step: number | null; operation: string; executionTruth: string }> = [];
  let verificationState = "not_run";
  const validHash = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  for (let index = 0; index < sourceSteps.length; index += 1) {
    const source = sourceSteps[index];
    const operation = typeof source.operation === "string" ? source.operation : "unknown";
    const executionTruth = typeof source.executionTruth === "string" ? source.executionTruth : "unknown";
    const effect = isRecord(source.workspaceClaimEffect) ? source.workspaceClaimEffect : null;
    const errors = Array.isArray(source.fieldErrors) ? source.fieldErrors.filter(isRecord) : [];
    const fieldErrors = errors.map((error): RecordValue => ({
      ...(typeof error.fieldPath === "string" ? { fieldPath: error.fieldPath } : {}),
      ...(typeof error.expectedSchemaId === "string" ? { expectedSchemaId: error.expectedSchemaId } : {}),
      ...(typeof error.preconditionCode === "string" ? { preconditionCode: error.preconditionCode } : {}),
      ...(typeof error.executionStarted === "boolean" ? { executionStarted: error.executionStarted } : {}),
      ...(validHash(error.afterSha256) ? { afterSha256: error.afterSha256 } : {}),
    }));
    const beforeSha256 = validHash(effect?.beforeSha256) ? effect.beforeSha256 : undefined;
    const effectAfterSha256 = validHash(effect?.afterSha256) ? effect.afterSha256 : undefined;
    const failureAfterSha256 = fieldErrors.map((error) => error.afterSha256).find(validHash);
    const afterSha256 = effectAfterSha256 ?? failureAfterSha256;
    const verification = isRecord(source.verificationClaimEffect) ? source.verificationClaimEffect : null;
    if (verification && typeof verification.verificationOutcome === "string") {
      verificationState = verification.verificationOutcome;
    }
    steps.push({
      operation,
      ...(typeof source.state === "string" ? { state: source.state } : {}),
      ...(typeof source.error === "string" ? { error: source.error } : {}),
      executionTruth,
      fieldErrors,
      ...(beforeSha256 ? { beforeSha256 } : {}),
      ...(afterSha256 ? { afterSha256 } : {}),
    });
    if (["effect_unknown", "effect_indeterminate", "effect_partial"].includes(executionTruth)) {
      unknownRemainder.push({ step: index + 1, operation, executionTruth });
    }
    if (beforeSha256 || afterSha256) {
      knownHashes.push({
        step: index + 1,
        ...(beforeSha256 ? { beforeSha256 } : {}),
        ...(afterSha256 ? { afterSha256 } : {}),
      });
    }
  }
  const licenseVerification = input.license.verificationClaimEffect;
  if (licenseVerification) verificationState = licenseVerification.verificationOutcome;
  if (unknownRemainder.length === 0
    && (input.license.executionTruth === "effect_unknown"
      || input.license.executionTruth === "effect_indeterminate"
      || input.license.executionTruth === "effect_partial")) {
    unknownRemainder.push({
      step: null,
      operation: typeof request?.operation === "string" ? request.operation : input.proposal.kind,
      executionTruth: input.license.executionTruth,
    });
  }

  return {
    ...(delegatedPurpose ? { delegatedPurpose } : {}),
    steps,
    knownHashes,
    unknownRemainder,
    verificationState,
    remainingAuthority: {
      workerDelegation: "terminated",
      proposalAuthorityEpoch: input.proposal.authorityEpoch,
    },
    remainingEffectRounds,
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
  const truths = result.stepResults.map((step) => step.license.executionTruth);
  const unknown = truths.some((truth) =>
    truth === "effect_unknown" || truth === "effect_indeterminate" || truth === "effect_partial",
  );
  const verified = truths.some((truth) => truth === "effect_verified" || truth === "effect_partial");
  const executionTruth = unknown && verified
    ? "effect_partial"
    : unknown
      ? "effect_unknown"
      : verified || result.state === "succeeded"
        ? "effect_verified"
        : result.state === "outcome_unknown" ? "effect_unknown" : undefined;
  return {
    state: result.state,
    taskId,
    profile: "inquiry_experiment",
    ...(result.error ? { error: result.error } : {}),
    ...(executionTruth ? { executionTruth } : {}),
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
  const webSearchProvider = options.adapters?.webSearchProvider ?? defaultWebSearchProvider;
  const webFetchProvider = options.adapters?.webFetchProvider ?? defaultWebFetchProvider;
  const adapters: LiveOperationAdapters = {
    executeProjectInspectionV2,
    executeWorkspaceExperimentV2,
    executeCandidateVerificationV2,
    executeCandidateAuthorshipV2,
    executeInquiryExperimentV2,
    executePatchExportV2,
    executeModeBWorker: executeCommandCodeWorker,
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
    signal?: AbortSignal,
    evidenceBinding?: {
      operationId?: string;
      conversationId?: string;
      cycleId?: string;
      generation?: number;
      wakeId?: string;
    },
  ): Promise<ModeBWorkerResult> {
    let cycleEvidence: Record<string, unknown> | undefined;
    if (options.sidecar) {
      try {
        cycleEvidence = options.sidecar.prepare(
          "SELECT conversation_id, generation, wake_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
        ).get(cycleId) as Record<string, unknown> | undefined;
      } catch {
        cycleEvidence = undefined;
      }
    }
    const boundEvidence = {
      ...evidenceBinding,
      conversationId: typeof cycleEvidence?.conversation_id === "string"
        ? cycleEvidence.conversation_id
        : evidenceBinding?.conversationId,
      cycleId,
      generation: typeof cycleEvidence?.generation === "number"
        ? cycleEvidence.generation
        : evidenceBinding?.generation,
      wakeId: typeof cycleEvidence?.wake_id === "string"
        ? cycleEvidence.wake_id
        : evidenceBinding?.wakeId,
    };
    const base = operationBase(nowMs);
    const operationDeadlineAtMs = Math.min(
      deadlineAtMs ?? Number.MAX_SAFE_INTEGER,
      base + DETACHED_WORKER_MAX_WALL_CLOCK_MS,
    );
    const sessionDeadlineAtMs = operationDeadlineAtMs - WORKER_FINALIZATION_RESERVE_MS;
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
    const workerInput: CommandCodeWorkerInput = {
      kind,
      request,
      purpose,
      apiKey: env.commandCodeApiKey,
      binaryPath: env.commandCodeBinaryPath,
      nodeExecutable: env.commandCodeNodePath,
      bubblewrapPath: env.commandCodeBubblewrapPath,
      minimumVersion: env.commandCodeMinimumVersion,
      qualificationStatePath: env.commandCodeQualificationStatePath,
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
      ...boundEvidence,
      nowMs,
      deadlineAtMs: operationDeadlineAtMs,
      signal,
      workerEnabled: env.commandCodeWorkerEnabled,
      gateOk,
      gateError: gateOk ? undefined : "worker_gate_denied",
    };
    const result = await adapters.executeModeBWorker(workerInput);
    try {
      const evidenceBinding: ModeBWorkerEvidenceBinding = Object.freeze({
        kind: workerInput.kind,
        operationId: workerInput.operationId ?? null,
        conversationId: workerInput.conversationId ?? null,
        cycleId: workerInput.cycleId ?? null,
        generation: workerInput.generation ?? null,
        wakeId: workerInput.wakeId ?? null,
      });
      const evidenceSnapshot: ModeBWorkerEvidenceSnapshot = Object.freeze({
        license: Object.freeze({
          state: result.license.state,
          error: result.license.error ?? null,
        }),
        selectedModelId: result.selectedModelId,
        commandCodeInvocations: Object.freeze(
          result.commandCodeInvocations.map((invocation) => Object.freeze({ ...invocation })),
        ),
      });
      options.onModeBWorkerResult?.(evidenceBinding, evidenceSnapshot);
    } catch {
      // Evidence observers cannot change a worker's execution result.
    }
    return result;
  }

  return {
    canOfferDetachedInvestigate(): boolean {
      if (options.adapters?.executeModeBWorker) return true;
      const readiness = commandCodeWorkerReadiness({
        workerEnabled: env.commandCodeWorkerEnabled,
        apiKey: env.commandCodeApiKey,
        binaryPath: env.commandCodeBinaryPath,
        nodeExecutable: env.commandCodeNodePath,
        minimumVersion: env.commandCodeMinimumVersion,
        bubblewrapPath: env.commandCodeBubblewrapPath,
        qualificationStatePath: env.commandCodeQualificationStatePath,
      });
      if (!readiness.ready) return false;
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
      const readiness = commandCodeWorkerReadiness({
        workerEnabled: env.commandCodeWorkerEnabled,
        apiKey: env.commandCodeApiKey,
        binaryPath: env.commandCodeBinaryPath,
        nodeExecutable: env.commandCodeNodePath,
        minimumVersion: env.commandCodeMinimumVersion,
        bubblewrapPath: env.commandCodeBubblewrapPath,
        qualificationStatePath: env.commandCodeQualificationStatePath,
      });
      if (!readiness.ready) {
        return { available: false as const, reason: "worker_unavailable", terminal: true as const };
      }
      if (!canOfferWorkerBackedProjectInspection(gate)) {
        return { available: false as const, reason: "worker_gate_denied", terminal: true as const };
      }
      return { available: true as const };
    },

    async runDetachedInvestigate(input: {
      request: unknown;
      operationId?: string;
      conversationId?: string;
      cycleId: string;
      generation?: number;
      wakeId?: string;
      purpose: string;
      deadlineAtMs?: number;
    }): Promise<ModeBWorkerResult> {
      return runModeB(MODE_B_INVESTIGATE, input.request, input.cycleId, input.purpose, undefined, input.deadlineAtMs, undefined, input);
    },

    async executeObservation(req): Promise<Observation> {
      if (req.kind === WEB_SEARCH_OPERATION_KIND) {
        try {
          return await executeWebSearchOperation({
            req,
            provider: webSearchProvider,
          });
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) throw error;
          throw new CapabilityUnavailableError("web_search_unavailable");
        }
      }
      if (req.kind === WEB_FETCH_OPERATION_KIND) {
        try {
          return await executeWebFetchOperation({
            req,
            provider: webFetchProvider,
            nowMs,
          });
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) throw error;
          throw new CapabilityUnavailableError("web_fetch_unavailable");
        }
      }
      if (isEvidenceOperationKind(req.kind)) {
        try {
          return await executeEvidenceOperation({
            req,
            nuclear: options.nuclear,
            sidecar: options.sidecar,
            ownerId: options.ownerId,
            nowMs,
            refresh: options.adapters?.refreshEvidence,
            webFetch: webFetchProvider,
          });
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) throw error;
          throw new CapabilityUnavailableError("evidence_unavailable");
        }
      }
      if (isTypedInspectionOperationKind(req.kind)) {
        try {
          const inspected = executeTypedInspection({
            req,
            nuclear: options.nuclear,
            sidecar: options.sidecar,
            ownerId: options.ownerId,
            nowMs,
            webSearchProvider,
          });
          if (inspected) return inspected;
          throw new CapabilityUnavailableError("inspect_request_invalid");
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) throw error;
          throw new CapabilityUnavailableError("inspect_unavailable");
        }
      }
      if (req.kind === CONCERN_INSPECTION_INTENT) {
        return executeConcernInspection(req, options.sidecar);
      }
      if (req.kind === MODE_B_INVESTIGATE) {
        let result: ModeBWorkerResult;
        try {
          result = await runModeB(req.kind, req.request, req.cycleId, "investigate", undefined, undefined, undefined, {
            operationId: req.requestId,
            cycleId: req.cycleId,
            generation: req.generation,
          });
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
      if (result.license.state !== "succeeded") {
        const failureCode = typeof result.license.error === "string"
          ? safeReasonCode(result.license.error)
          : "project_inspection_failed";
        throw new CapabilityUnavailableError(failureCode);
      }
      if (
        result.observation === null ||
        result.observation.projectId !== request.projectId ||
        result.observation.operation !== request.operation
      ) throw new CapabilityUnavailableError("project_inspection_result_invalid");
      const fileObservation = result.observation.operation === "project.read_file"
        ? result.observation
        : null;
      const returnedSelector: import("../types.js").JsonValue = fileObservation?.truncated
        ? { kind: "text_window", offsetChars: 0, limitChars: fileObservation.contentUtf8?.length ?? 0 }
        : { kind: "whole_file" };
      const view = fileObservation === null || typeof fileObservation.contentUtf8 !== "string" ? undefined : {
        ...projectFileArtifactIdentity({
          projectId: fileObservation.projectId,
          path: fileObservation.path,
          rawByteHash: fileObservation.sha256,
          capturedAtMs: fileObservation.executedAtMs,
        }),
        requestedSelector: { kind: "whole_file" } as const,
        returnedSelector,
        completeness: fileObservation.truncated ? "partial" as const : "complete" as const,
        omission: fileObservation.truncated ? { reason: "source_truncated" } as const : null,
        continuation: null,
        errors: [],
        contentHashBasis: "raw_bytes",
      };
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
        ...(view === undefined ? {} : { view }),
      };
    },

    async executeEffect(proposal, control): Promise<EffectReceipt> {
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
      let continuationSteps: readonly RecordValue[] | undefined;
      let diagnosticRef: string | null = null;
      let diagnosticPersistence: "not_requested" | "recorded" | "unavailable" | "failed" = "not_requested";
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
            continuationSteps = result.stepResults.map((step) => ({
              operation: step.operation,
              state: step.license.state,
              error: step.license.error ?? null,
              executionTruth: step.license.executionTruth ?? null,
              fieldErrors: step.license.fieldErrors ?? [],
              workspaceClaimEffect: step.license.workspaceClaimEffect ?? null,
              verificationClaimEffect: step.license.verificationClaimEffect ?? null,
            }));
            license = inquiryResultLicense(result, proposal.effectId, proposal.cycleId);
          }
        } else if (WORKSPACE_OPERATIONS.has(operation)) {
          const request = normalizeWorkspaceRequest(proposal, operation);
          if (!request) license = unavailableLicense("project_experimentation", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const operationDeadlineAtMs = Math.min(base + 60_000, control?.deadlineAtMs ?? Number.MAX_SAFE_INTEGER);
            const result = await adapters.executeWorkspaceExperimentV2({
              ...common,
              request,
              taskId: proposal.effectId,
              messageEntityUuid: proposal.cycleId,
              deadlineAtMs: operationDeadlineAtMs,
              childExecutionDeadlineAtMs: Math.min(operationDeadlineAtMs, base + 30_000),
              childTerminationDeadlineAtMs: Math.min(operationDeadlineAtMs, base + 45_000),
              settlementDeadlineAtMs: operationDeadlineAtMs,
            });
            license = resultLicense(result);
          }
        } else if (operation === "workspace.verify") {
          const request = normalizeVerificationRequest(proposal);
          if (!request) license = unavailableLicense("candidate_verification", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const operationDeadlineAtMs = Math.min(base + 60_000, control?.deadlineAtMs ?? Number.MAX_SAFE_INTEGER);
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
              deadlineAtMs: operationDeadlineAtMs,
            });
            license = resultLicense(result);
          }
        } else if (operation === "changeset.author") {
          const request = normalizeAuthorshipRequest(proposal);
          if (!request) license = unavailableLicense("candidate_authorship", "invalid_request");
          else {
            const base = operationBase(nowMs);
            const operationDeadlineAtMs = Math.min(base + 60_000, control?.deadlineAtMs ?? Number.MAX_SAFE_INTEGER);
            const result = await adapters.executeCandidateAuthorshipV2({
              ...common,
              request,
              taskId: proposal.effectId,
              ownerId: options.ownerId,
              messageEntityUuid: proposal.cycleId,
              deadlineAtMs: operationDeadlineAtMs,
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
              control?.deadlineAtMs,
              control?.signal,
              {
                operationId: proposal.effectId,
                cycleId: proposal.cycleId,
                generation: proposal.generation,
              },
            );
            modeBResult = result;
            license = {
              ...result.license,
              taskId: proposal.effectId,
              sourceMessageEntityUuid: proposal.cycleId,
            };
          } catch {
            license = unavailableLicense("command_code_mode_b", "effect_unavailable");
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
      if (operation === MODE_B_DEVELOP) {
        if (modeBResult) {
          try {
            diagnosticRef = persistModeBEffectDiagnostic(
              proposal,
              modeBResult,
              options.sidecar,
              nowMs(),
            );
            diagnosticPersistence = diagnosticRef ? "recorded" : "unavailable";
          } catch {
            diagnosticPersistence = "failed";
          }
        } else {
          diagnosticPersistence = "unavailable";
        }
      }
      const receipt = receiptFromLicense(proposal, license, nowMs, options.sidecar);
      const continuationClaims = receiptContinuationClaims({
        proposal,
        license,
        modeBResult,
        steps: continuationSteps,
        db: options.sidecar,
      });
      if (!modeBResult) {
        return {
          ...receipt,
          claims: {
            ...receipt.claims,
            ...continuationClaims,
            ...(diagnosticPersistence !== "not_requested" ? { diagnosticPersistence } : {}),
          },
        };
      }
      return {
        ...receipt,
        claims: {
          ...receipt.claims,
          ...continuationClaims,
          selectedModelId: modeBResult.selectedModelId,
          summary: modeBResult.summary,
          commandCodeInvocations: modeBResult.commandCodeInvocations,
          ...(diagnosticPersistence !== "not_requested" ? { diagnosticPersistence } : {}),
          ...(diagnosticRef ? { diagnosticRef } : {}),
        },
      };
    },
  };
}

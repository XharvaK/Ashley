import type { DatabaseSync } from "node:sqlite";
import { env } from "../../../env.js";
import {
  executeCandidateAuthorshipV2,
  executeCandidateVerificationV2,
  executeProjectInspectionV2,
  executeWorkspaceExperimentV2,
  type ExecuteCandidateAuthorshipV2Result,
  type ExecuteCandidateVerificationV2Result,
  type ExecuteProjectInspectionV2Result,
  type ExecuteWorkspaceExperimentV2Result,
} from "../../sandbox/v2-execution.js";
import {
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "../../sandbox/project-registry.js";
import type { SandboxV2Dispatcher, SandboxV2Environment, WorkspaceManager } from "@composer-assistant/sandbox-v2";
import type {
  CognitionAuthorshipRequest,
  CognitionInspectionRequest,
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

const PROJECT_OPERATIONS = new Set([
  "project.read_file",
  "project.list_directory",
  "project.search_text",
]);

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
};

type LiveOperationAdapters = {
  executeProjectInspectionV2: typeof executeProjectInspectionV2;
  executeWorkspaceExperimentV2: typeof executeWorkspaceExperimentV2;
  executeCandidateVerificationV2: typeof executeCandidateVerificationV2;
  executeCandidateAuthorshipV2: typeof executeCandidateAuthorshipV2;
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
  if (!PROJECT_OPERATIONS.has(req.kind)) return null;
  const value = requestRecord(req.request);
  const projectId = stringValue(value?.projectId);
  if (!projectId) return null;

  if (req.kind === "project.search_text") {
    const pattern = stringValue(value?.pattern);
    if (!pattern) return null;
    return {
      operation: req.kind,
      projectId,
      ...(typeof value?.path === "string" ? { path: value.path } : {}),
      pattern,
      ...(typeof value?.maxMatches === "number" ? { maxMatches: value.maxMatches } : {}),
    };
  }

  const path = stringValue(value?.path);
  if (!path) return null;
  return { operation: req.kind, projectId, path };
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
    license.error === "missing_path"
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
    | ExecuteCandidateAuthorshipV2Result,
): OperationalClaimLicense {
  return result.license;
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

  return {
    async executeObservation(req): Promise<Observation> {
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

      let license: OperationalClaimLicense;
      try {
        if (WORKSPACE_OPERATIONS.has(operation)) {
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
        } else {
          license = unavailableLicense("cognitive_effect", "unsupported_operation");
        }
      } catch {
        license = unavailableLicense("cognitive_effect", "effect_unavailable");
      }
      return receiptFromLicense(proposal, license, nowMs, options.sidecar);
    },
  };
}

/**
 * Sandbox V2 M6 agent adapter: admit one finite objective and run the
 * sequential controller over already-accepted M3/M4/M5 executors.
 *
 * The controller is not a second cognitive owner. Thought admits the sequence.
 * This module bounds, executes each admitted step once, and stops.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  admitBoundedOperationSequence,
  M6_MAX_WALL_MS,
  runBoundedOperation,
  type M6StepSpec,
  type SandboxV2Dispatcher,
  type SandboxV2Environment,
} from "@composer-assistant/sandbox-v2";
import { env } from "../../env.js";
import type { CognitionMode } from "../types.js";
import type { CognitionBoundedOperationRequest } from "../types.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import type { OperationalClaimLicense } from "./engineering-types.js";
import {
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "./project-registry.js";
import {
  executeCandidateAuthorshipV2,
  executeCandidateVerificationV2,
  executeWorkspaceExperimentV2,
} from "./v2-execution.js";
import {
  finalizeBoundedOperation,
  isBoundedOperationCancelRequested,
  persistAdmittedBoundedOperation,
} from "./bounded-operation-store.js";

export type ExecuteBoundedOperationV2Input = {
  request: CognitionBoundedOperationRequest;
  ownerId?: string;
  messageEntityUuid?: string;
  dispatcher?: SandboxV2Dispatcher;
  registry?: V2ProjectReadRegistry;
  workspaceManager?: import("@composer-assistant/sandbox-v2").WorkspaceManager;
  envOverrides?: Partial<SandboxV2Environment> & {
    sandboxEngineeringLifecycleEnabled?: boolean;
  };
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  skipCapabilityGate?: boolean;
  clock?: { nowMs(): number };
  cancelled?: () => boolean;
  taskId?: string;
  originJobId?: string;
  stopAfterAdmit?: boolean;
};

export type ExecuteBoundedOperationV2Result = {
  license: OperationalClaimLicense;
};

function none(
  error: string,
  extras?: Partial<OperationalClaimLicense>,
  messageEntityUuid?: string,
): ExecuteBoundedOperationV2Result {
  return {
    license: {
      state: "none",
      taskId: extras?.taskId ?? `v2-operate-${Date.now()}`,
      profile: "bounded_operation",
      error,
      ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
      ...extras,
    },
  };
}

function toStepSpec(request: CognitionBoundedOperationRequest): M6StepSpec[] {
  return request.steps.map((step) => {
    switch (step.kind) {
      case "candidate_workspace_experiment":
        return { kind: step.kind, operation: step.request.operation };
      case "candidate_verification":
        return { kind: step.kind, operation: step.request.operation };
      case "candidate_authorship":
        return { kind: step.kind, operation: step.request.operation };
      default: {
        const _exhaustive: never = step;
        return _exhaustive;
      }
    }
  });
}

function mapChildError(error: string): string {
  switch (error) {
    case "sandbox_lifecycle_disabled":
    case "authorship_not_allowed":
    case "verification_not_allowed":
    case "workspace_not_allowed":
    case "candidate_workspace_not_allowed":
    case "engineering_not_allowed":
    case "read_not_allowed":
      return "authority_lost";
    default:
      if (error.endsWith("_gate_denied")) return "authority_lost";
      return error;
  }
}

function statusForStop(
  reason: string,
): "succeeded" | "failed" | "cancelled" | "deadline_exceeded" {
  switch (reason) {
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "deadline_exceeded":
      return "deadline_exceeded";
    default:
      return "failed";
  }
}

function honestyFor(stopReason: string, stepsExecuted: number, maxSteps: number): string {
  if (stopReason === "succeeded") {
    return `completed ${stepsExecuted} admitted sandbox operations toward the named objective. no border effect was performed.`;
  }
  return `stopped after ${stepsExecuted} of ${maxSteps} admitted sandbox operations because ${stopReason}. no border effect was performed.`;
}

export async function executeBoundedOperationV2(
  input: ExecuteBoundedOperationV2Input,
): Promise<ExecuteBoundedOperationV2Result> {
  const { request, messageEntityUuid } = input;
  const taskId = input.taskId?.trim() || `v2-operate-${randomBytes(8).toString("hex")}`;
  const nowMs = () => (input.clock ? input.clock.nowMs() : Date.now());

  if (input.db && !input.skipCapabilityGate) {
    try {
      if (!capabilityCanInfluence(input.db, "bounded_operation", input.masterMode)) {
        return none("bounded_operation_gate_denied", { taskId }, messageEntityUuid);
      }
    } catch {
      return none("bounded_operation_gate_denied", { taskId }, messageEntityUuid);
    }
  }

  const lifecycleEnabled =
    input.envOverrides?.sandboxEngineeringLifecycleEnabled !== undefined
      ? input.envOverrides.sandboxEngineeringLifecycleEnabled
      : env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycleEnabled) {
    return none("sandbox_lifecycle_disabled", { taskId }, messageEntityUuid);
  }

  if (!input.ownerId) {
    return none("owner_id_required", { taskId }, messageEntityUuid);
  }

  const registry =
    input.registry ??
    input.envOverrides?.registry ??
    loadOperatorProjectReadRegistry();
  const resolved = registry.resolveReadRoot(request.projectId);
  if (!resolved.ok) {
    return none(resolved.error, { taskId }, messageEntityUuid);
  }
  if (resolved.entry.operationAllowed !== true) {
    return none("bounded_operation_not_allowed", { taskId }, messageEntityUuid);
  }

  if (nowMs() >= request.budget.deadlineAtMs) {
    return {
      license: {
        state: "failed",
        taskId,
        profile: "bounded_operation",
        error: "deadline_exceeded",
        ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
      },
    };
  }
  if (request.budget.deadlineAtMs - nowMs() > M6_MAX_WALL_MS) {
    return none("wall_budget_exceeded", { taskId }, messageEntityUuid);
  }

  const stepSpecs = toStepSpec(request);
  const admitted = admitBoundedOperationSequence({
    steps: stepSpecs,
    maxSteps: request.budget.maxSteps,
  });
  if (!admitted.ok) {
    return none(admitted.reason, { taskId }, messageEntityUuid);
  }

  let activeWorkspaceId = request.workspaceId;

  if (input.db) {
    persistAdmittedBoundedOperation(input.db, {
      ownerId: input.ownerId,
      taskId,
      projectId: request.projectId,
      workspaceId: request.workspaceId ?? "pending_acquisition",
      origin: request.origin,
      objective: request.objective,
      successCondition: request.successCondition,
      failureCondition: request.failureCondition,
      admittedStepsJson: JSON.stringify(
        request.steps.map((step) => ({ kind: step.kind, operation: step.request.operation })),
      ),
      maxSteps: request.budget.maxSteps,
      deadlineAtMs: request.budget.deadlineAtMs,
      originJobId: input.originJobId ?? null,
    });
  }

  if (input.stopAfterAdmit) {
    return {
      license: {
        state: "none",
        taskId,
        profile: "bounded_operation",
        error: null,
        ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
      },
    };
  }

  const shared = {
    ownerId: input.ownerId,
    messageEntityUuid,
    dispatcher: input.dispatcher,
    registry,
    workspaceManager: input.workspaceManager,
    envOverrides: input.envOverrides,
    db: input.db,
    masterMode: input.masterMode,
    deadlineAtMs: request.budget.deadlineAtMs,
  };

  const result = await runBoundedOperation({
    steps: stepSpecs,
    maxSteps: request.budget.maxSteps,
    deadlineAtMs: request.budget.deadlineAtMs,
    clock: { nowMs },
    cancelled: () => {
      if (input.cancelled?.()) return true;
      if (!input.db) return false;
      return isBoundedOperationCancelRequested(input.db, taskId);
    },
    executeStep: async (spec, index) => {
      const admitted = request.steps[index];
      if (!admitted || admitted.kind !== spec.kind) {
        return { ok: false, error: "step_identity_mismatch" };
      }
      switch (admitted.kind) {
        case "candidate_workspace_experiment": {
          const stepReq = {
            ...admitted.request,
            ...(activeWorkspaceId && !admitted.request.workspaceId
              ? { workspaceId: activeWorkspaceId }
              : {}),
          };
          const child = await executeWorkspaceExperimentV2({
            ...shared,
            request: stepReq,
          });
          if (child.license.workspaceClaimEffect?.workspaceId) {
            activeWorkspaceId = child.license.workspaceClaimEffect.workspaceId;
          }
          if (child.license.state === "succeeded") return { ok: true };
          return { ok: false, error: mapChildError(child.license.error ?? "step_failed") };
        }
        case "candidate_verification": {
          const stepReq = {
            ...admitted.request,
            ...(activeWorkspaceId && !admitted.request.workspaceId
              ? { workspaceId: activeWorkspaceId }
              : {}),
          };
          const child = await executeCandidateVerificationV2({
            ...shared,
            request: stepReq,
          });
          if (child.license.verificationClaimEffect?.workspaceId) {
            activeWorkspaceId = child.license.verificationClaimEffect.workspaceId;
          }
          if (child.license.state === "succeeded") return { ok: true };
          return { ok: false, error: mapChildError(child.license.error ?? "step_failed") };
        }
        case "candidate_authorship": {
          const stepReq = {
            ...admitted.request,
            ...(activeWorkspaceId && !admitted.request.workspaceId
              ? { workspaceId: activeWorkspaceId }
              : {}),
          };
          const child = await executeCandidateAuthorshipV2({
            ...shared,
            request: stepReq,
          });
          if (child.license.authorshipClaimEffect?.workspaceId) {
            activeWorkspaceId = child.license.authorshipClaimEffect.workspaceId;
          }
          if (child.license.state === "succeeded") return { ok: true };
          return { ok: false, error: mapChildError(child.license.error ?? "step_failed") };
        }
        default: {
          const _exhaustive: never = admitted;
          return { ok: false, error: `unhandled_step:${String(_exhaustive)}` };
        }
      }
    },
  });

  if (input.db) {
    finalizeBoundedOperation(input.db, {
      ownerId: input.ownerId,
      taskId,
      status: statusForStop(result.stopReason),
      stopReason: result.stopReason,
      stepsExecuted: result.stepsExecuted,
      stepRecords: result.stepRecords,
      workspaceId: activeWorkspaceId,
    });
  }

  const succeeded = result.stopReason === "succeeded";
  const claim = {
    verified: true as const,
    projectId: request.projectId,
    workspaceId: activeWorkspaceId ?? request.workspaceId ?? "unknown",
    taskId,
    stepsExecuted: result.stepsExecuted,
    maxSteps: request.budget.maxSteps,
    stopReason: result.stopReason,
    borderState: "none" as const,
    applied: false as const,
    exported: false as const,
    protocolState: "admitted" as const,
    completedAtMs: nowMs(),
  };

  return {
    license: {
      state: succeeded ? "succeeded" : "failed",
      taskId,
      profile: "bounded_operation",
      error: succeeded ? null : result.stopReason,
      boundedOperationClaimEffect: claim,
      cancellationRequested: result.stopReason === "cancelled",
      ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
    },
  };
}

export function boundedOperationHonesty(
  stopReason: string,
  stepsExecuted: number,
  maxSteps: number,
): string {
  return honestyFor(stopReason, stepsExecuted, maxSteps);
}

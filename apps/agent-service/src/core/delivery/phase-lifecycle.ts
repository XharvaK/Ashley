import type { DatabaseSync } from "node:sqlite";
import type {
  TurnDeadlineBranchKind,
  TurnDeadlinePlan,
} from "./turn-deadline-plan.js";

export const PHASE_LIFECYCLE_VERSION = 1 as const;
export const PHASE_LIFECYCLE_MAX_BYTES = 8_192;
/**
 * Parser ceiling for `deadlineOffsetsMs` keys.
 *
 * Production M3+M4 encoder count (provisional policy, M5 authorship closed):
 * 24 common/M1/M2 keys + 14 M3 workspace keys + 4 M4 verification keys = 42.
 * M5 authorship adds 4 more (46) if that branch is ever available.
 * The previous cap of 40 discarded the envelope (`phase_lifecycle_missing`)
 * once M4 offsets existed. 64 is a fixed parser bound, not a model-controlled
 * budget: Thought cannot add keys, and values above 64 still fail closed.
 */
export const PHASE_LIFECYCLE_MAX_DEADLINE_KEYS = 64;

export type PhaseLifecyclePhase =
  | "admission"
  | "initial_thought"
  | "sandbox_m1"
  | "project_inspection_preparation"
  | "project_inspection"
  | "candidate_workspace_experiment"
  | "candidate_verification"
  | "candidate_authorship"
  | "continuation"
  | "perception"
  | "expression"
  | "generation"
  | "transport"
  | "first_bubble"
  | "delivery";

export type PhaseLifecycleState =
  | "admitted"
  | "started"
  | "dispatched"
  | "completed"
  | "settled"
  | "skipped"
  | "succeeded"
  | "failed";

export type PhaseLifecycleEvent =
  | PhaseLifecycleState
  | "cancellation_requested"
  | "cancellation_acknowledged";

export type M3ExecutionTruth =
  | "no_effect_proven"
  | "effect_verified"
  | "effect_indeterminate";

export type PhaseLifecyclePhaseSummary = {
  state: PhaseLifecycleState;
  admittedOffsetMs?: number;
  startedOffsetMs?: number;
  dispatchedOffsetMs?: number;
  finishedOffsetMs?: number;
  statusCode?: string;
  cancellationRequested?: boolean;
  cancellationAcknowledged?: boolean;
  executionTruth?: M3ExecutionTruth;
};

export type PhaseLifecycleEnvelope = {
  version: typeof PHASE_LIFECYCLE_VERSION;
  planVersion: string;
  qualification: TurnDeadlinePlan["qualification"];
  selectedBranch: TurnDeadlineBranchKind | null;
  selectedAtOffsetMs: number | null;
  deadlineOffsetsMs: Record<string, number>;
  phases: Partial<Record<PhaseLifecyclePhase, PhaseLifecyclePhaseSummary>>;
};

const PHASES = new Set<PhaseLifecyclePhase>([
  "admission",
  "initial_thought",
  "sandbox_m1",
  "project_inspection_preparation",
  "project_inspection",
  "candidate_workspace_experiment",
  "candidate_verification",
  "candidate_authorship",
  "continuation",
  "perception",
  "expression",
  "generation",
  "transport",
  "first_bubble",
  "delivery",
]);

const STATES = new Set<PhaseLifecycleState>([
  "admitted",
  "started",
  "dispatched",
  "completed",
  "settled",
  "skipped",
  "succeeded",
  "failed",
]);

const BRANCHES = new Set<TurnDeadlineBranchKind>([
  "ordinary",
  "sandbox_m1",
  "project_inspection",
  "candidate_workspace_experiment",
  "candidate_verification",
  "candidate_authorship",
]);

const EXECUTION_TRUTHS = new Set<M3ExecutionTruth>([
  "no_effect_proven",
  "effect_verified",
  "effect_indeterminate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedOffset(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 86_400_000
    ? value
    : null;
}

function safeCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /^[a-z0-9][a-z0-9_:-]{0,63}$/.test(value)
    ? value
    : "unclassified_error";
}

function safePlanVersion(value: string): string {
  return /^[a-z0-9][a-z0-9_.:-]{0,63}$/.test(value)
    ? value
    : "unknown_plan";
}

function offset(plan: TurnDeadlinePlan, atMs: number): number {
  return Math.max(0, Math.min(86_400_000, Math.round(atMs - plan.admittedAtMs)));
}

export function deadlineOffsets(plan: TurnDeadlinePlan): Record<string, number> {
  const result: Record<string, number> = {
    softResponsiveness: offset(plan, plan.common.softResponsivenessTargetAtMs),
    initialThought: offset(plan, plan.common.initialThoughtDeadlineAtMs),
    externalTransport: offset(plan, plan.common.externalTransportHardDeadlineAtMs),
    firstBubbleReceipt: offset(plan, plan.common.firstBubbleReceiptDeadlineAtMs),
    deliveryFinal: offset(plan, plan.common.reservationHardDeadlineAtMs),
    ordinaryPerception: offset(plan, plan.branches.ordinary.perceptionDeadlineAtMs),
    ordinaryExpression: offset(plan, plan.branches.ordinary.expressionDeadlineAtMs),
    ordinaryGeneration: offset(plan, plan.branches.ordinary.generationDeadlineAtMs),
    sandboxM1Child: offset(plan, plan.branches.sandbox_m1.childExecutionDeadlineAtMs),
    sandboxM1ChildTermination: offset(
      plan,
      plan.branches.sandbox_m1.childTerminationDeadlineAtMs,
    ),
    sandboxM1Settlement: offset(
      plan,
      plan.branches.sandbox_m1.acquisitionSettlementDeadlineAtMs,
    ),
    sandboxM1Perception: offset(
      plan,
      plan.branches.sandbox_m1.perceptionDeadlineAtMs,
    ),
    sandboxM1Expression: offset(plan, plan.branches.sandbox_m1.expressionDeadlineAtMs),
    sandboxM1Generation: offset(plan, plan.branches.sandbox_m1.generationDeadlineAtMs),
    projectInspectionPreparation: offset(
      plan,
      plan.branches.project_inspection.projectInspectionPreparationDeadlineAtMs,
    ),
    projectInspectionSettlement: offset(
      plan,
      plan.branches.project_inspection.acquisitionSettlementDeadlineAtMs,
    ),
    projectInspectionChildTermination: offset(
      plan,
      plan.branches.project_inspection.childTerminationDeadlineAtMs,
    ),
    projectInspectionContinuation: offset(
      plan,
      plan.branches.project_inspection.continuationDeadlineAtMs,
    ),
    projectInspectionPerception: offset(
      plan,
      plan.branches.project_inspection.perceptionDeadlineAtMs,
    ),
    projectInspectionExpression: offset(
      plan,
      plan.branches.project_inspection.expressionDeadlineAtMs,
    ),
    projectInspectionGeneration: offset(
      plan,
      plan.branches.project_inspection.generationDeadlineAtMs,
    ),
  };
  for (const [operation, deadlineAtMs] of Object.entries(
    plan.branches.project_inspection.childExecutionDeadlineAtMs,
  )) {
    result[`projectInspectionChild:${operation}`] = offset(plan, deadlineAtMs);
  }
  const workspace = plan.branches.candidate_workspace_experiment;
  if (workspace.available) {
    result.candidateWorkspaceChildTermination = offset(
      plan,
      workspace.childTerminationDeadlineAtMs,
    );
    result.candidateWorkspaceSettlement = offset(
      plan,
      workspace.acquisitionSettlementDeadlineAtMs,
    );
    result.candidateWorkspaceContinuation = offset(
      plan,
      workspace.continuationDeadlineAtMs,
    );
    result.candidateWorkspacePerception = offset(
      plan,
      workspace.perceptionDeadlineAtMs,
    );
    result.candidateWorkspaceExpression = offset(plan, workspace.expressionDeadlineAtMs);
    result.candidateWorkspaceGeneration = offset(plan, workspace.generationDeadlineAtMs);
    for (const [operation, deadlineAtMs] of Object.entries(
      workspace.childExecutionDeadlineAtMs,
    )) {
      result[`candidateWorkspaceChild:${operation}`] = offset(plan, deadlineAtMs);
    }
  }
  const verification = plan.branches.candidate_verification;
  if (verification.available) {
    result.candidateVerificationChild = offset(
      plan,
      verification.childExecutionDeadlineAtMs,
    );
    result.candidateVerificationChildTermination = offset(
      plan,
      verification.childTerminationDeadlineAtMs,
    );
    result.candidateVerificationSettlement = offset(
      plan,
      verification.acquisitionSettlementDeadlineAtMs,
    );
    result.candidateVerificationContinuation = offset(
      plan,
      verification.continuationDeadlineAtMs,
    );
  }
  const authorship = plan.branches.candidate_authorship;
  if (authorship.available) {
    result.candidateAuthorshipChild = offset(
      plan,
      authorship.childExecutionDeadlineAtMs,
    );
    result.candidateAuthorshipChildTermination = offset(
      plan,
      authorship.childTerminationDeadlineAtMs,
    );
    result.candidateAuthorshipSettlement = offset(
      plan,
      authorship.acquisitionSettlementDeadlineAtMs,
    );
    result.candidateAuthorshipContinuation = offset(
      plan,
      authorship.continuationDeadlineAtMs,
    );
  }
  return result;
}

function parsePhaseSummary(value: unknown): PhaseLifecyclePhaseSummary | null {
  if (!isRecord(value) || !STATES.has(value.state as PhaseLifecycleState)) return null;
  const summary: PhaseLifecyclePhaseSummary = {
    state: value.state as PhaseLifecycleState,
  };
  for (const key of [
    "admittedOffsetMs",
    "startedOffsetMs",
    "dispatchedOffsetMs",
    "finishedOffsetMs",
  ] as const) {
    if (value[key] !== undefined) {
      const parsed = boundedOffset(value[key]);
      if (parsed === null) return null;
      summary[key] = parsed;
    }
  }
  if (value.statusCode !== undefined) {
    if (typeof value.statusCode !== "string") return null;
    summary.statusCode = safeCode(value.statusCode);
  }
  if (value.cancellationRequested !== undefined) {
    if (typeof value.cancellationRequested !== "boolean") return null;
    summary.cancellationRequested = value.cancellationRequested;
  }
  if (value.cancellationAcknowledged !== undefined) {
    if (typeof value.cancellationAcknowledged !== "boolean") return null;
    summary.cancellationAcknowledged = value.cancellationAcknowledged;
  }
  if (value.executionTruth !== undefined) {
    if (!EXECUTION_TRUTHS.has(value.executionTruth as M3ExecutionTruth)) return null;
    summary.executionTruth = value.executionTruth as M3ExecutionTruth;
  }
  return summary;
}

export function parsePhaseLifecycleJson(
  raw: string | null | undefined,
): PhaseLifecycleEnvelope | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > PHASE_LIFECYCLE_MAX_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== PHASE_LIFECYCLE_VERSION) return null;
    if (
      typeof parsed.planVersion !== "string" ||
      !["unqualified", "test_only", "qualified"].includes(String(parsed.qualification)) ||
      !isRecord(parsed.deadlineOffsetsMs) ||
      !isRecord(parsed.phases)
    ) {
      return null;
    }
    const selectedBranch =
      parsed.selectedBranch === null
        ? null
        : BRANCHES.has(parsed.selectedBranch as TurnDeadlineBranchKind)
          ? (parsed.selectedBranch as TurnDeadlineBranchKind)
          : undefined;
    if (selectedBranch === undefined) return null;
    const selectedAtOffsetMs =
      parsed.selectedAtOffsetMs === null
        ? null
        : boundedOffset(parsed.selectedAtOffsetMs);
    if (selectedAtOffsetMs === null && parsed.selectedAtOffsetMs !== null) return null;
    const parsedDeadlines: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed.deadlineOffsetsMs)) {
      if (!/^[A-Za-z][A-Za-z0-9:._-]{0,63}$/.test(key)) return null;
      const deadline = boundedOffset(value);
      if (deadline === null) return null;
      parsedDeadlines[key] = deadline;
    }
    if (Object.keys(parsedDeadlines).length > PHASE_LIFECYCLE_MAX_DEADLINE_KEYS) {
      return null;
    }
    const phases: PhaseLifecycleEnvelope["phases"] = {};
    for (const [key, value] of Object.entries(parsed.phases)) {
      if (!PHASES.has(key as PhaseLifecyclePhase)) return null;
      const phase = parsePhaseSummary(value);
      if (!phase) return null;
      phases[key as PhaseLifecyclePhase] = phase;
    }
    return {
      version: PHASE_LIFECYCLE_VERSION,
      planVersion: safePlanVersion(parsed.planVersion),
      qualification: parsed.qualification as PhaseLifecycleEnvelope["qualification"],
      selectedBranch,
      selectedAtOffsetMs,
      deadlineOffsetsMs: parsedDeadlines,
      phases,
    };
  } catch {
    return null;
  }
}

function writeLifecycle(
  db: DatabaseSync,
  reservationId: number,
  lifecycle: PhaseLifecycleEnvelope,
): void {
  const raw = JSON.stringify(lifecycle);
  if (Buffer.byteLength(raw, "utf8") > PHASE_LIFECYCLE_MAX_BYTES) {
    throw new Error("phase_lifecycle_too_large");
  }
  db.prepare(
    "UPDATE delivery_reservations SET phase_lifecycle_json = ? WHERE id = ?",
  ).run(raw, reservationId);
}

export function initializePhaseLifecycle(
  db: DatabaseSync,
  reservationId: number,
  plan: TurnDeadlinePlan,
): PhaseLifecycleEnvelope {
  const lifecycle: PhaseLifecycleEnvelope = {
    version: PHASE_LIFECYCLE_VERSION,
    planVersion: safePlanVersion(plan.version),
    qualification: plan.qualification,
    selectedBranch: null,
    selectedAtOffsetMs: null,
    deadlineOffsetsMs: deadlineOffsets(plan),
    phases: { admission: { state: "admitted", admittedOffsetMs: 0 } },
  };
  writeLifecycle(db, reservationId, lifecycle);
  return lifecycle;
}

export function readPhaseLifecycle(
  db: DatabaseSync,
  reservationId: number,
): PhaseLifecycleEnvelope | null {
  const row = db
    .prepare("SELECT phase_lifecycle_json FROM delivery_reservations WHERE id = ?")
    .get(reservationId) as { phase_lifecycle_json?: string | null } | undefined;
  return parsePhaseLifecycleJson(row?.phase_lifecycle_json);
}

function updateExisting(
  db: DatabaseSync,
  reservationId: number,
  update: (lifecycle: PhaseLifecycleEnvelope) => void,
): PhaseLifecycleEnvelope {
  const lifecycle = readPhaseLifecycle(db, reservationId);
  if (!lifecycle) throw new Error("phase_lifecycle_missing");
  update(lifecycle);
  writeLifecycle(db, reservationId, lifecycle);
  return lifecycle;
}

function reservationAdmittedAtMs(db: DatabaseSync, reservationId: number): number {
  const row = db
    .prepare("SELECT created_at FROM delivery_reservations WHERE id = ?")
    .get(reservationId) as { created_at?: string } | undefined;
  const parsed = Date.parse(row?.created_at ?? "");
  if (!Number.isFinite(parsed)) throw new Error("phase_lifecycle_admission_missing");
  return parsed;
}

export function selectPhaseLifecycleBranch(
  db: DatabaseSync,
  reservationId: number,
  branch: TurnDeadlineBranchKind,
  atMs: number,
): PhaseLifecycleEnvelope {
  const admittedAtMs = reservationAdmittedAtMs(db, reservationId);
  return updateExisting(db, reservationId, (lifecycle) => {
    if (lifecycle.selectedBranch !== null && lifecycle.selectedBranch !== branch) {
      throw new Error("phase_lifecycle_branch_already_selected");
    }
    lifecycle.selectedBranch = branch;
    lifecycle.selectedAtOffsetMs = Math.max(0, Math.round(atMs - admittedAtMs));
  });
}

export function recordPhaseLifecycle(
  db: DatabaseSync,
  input: {
    reservationId: number;
    phase: PhaseLifecyclePhase;
    event: PhaseLifecycleEvent;
    atMs: number;
    statusCode?: string;
    executionTruth?: M3ExecutionTruth;
  },
): PhaseLifecycleEnvelope {
  const admittedAtMs = reservationAdmittedAtMs(db, input.reservationId);
  const atOffsetMs = Math.max(
    0,
    Math.min(86_400_000, Math.round(input.atMs - admittedAtMs)),
  );
  return updateExisting(db, input.reservationId, (lifecycle) => {
    const current = lifecycle.phases[input.phase] ?? { state: "admitted" as const };
    if (input.event === "cancellation_requested") {
      current.cancellationRequested = true;
    } else if (input.event === "cancellation_acknowledged") {
      current.cancellationAcknowledged = true;
    } else {
      current.state = input.event;
      if (input.event === "admitted") current.admittedOffsetMs = atOffsetMs;
      if (input.event === "started") current.startedOffsetMs = atOffsetMs;
      if (input.event === "dispatched") current.dispatchedOffsetMs = atOffsetMs;
      if (
        ["settled", "skipped", "succeeded", "failed", "completed"].includes(
          input.event,
        )
      ) {
        current.finishedOffsetMs = atOffsetMs;
      }
    }
    const statusCode = safeCode(input.statusCode);
    if (statusCode !== undefined) current.statusCode = statusCode;
    if (input.executionTruth !== undefined) current.executionTruth = input.executionTruth;
    lifecycle.phases[input.phase] = current;
  });
}

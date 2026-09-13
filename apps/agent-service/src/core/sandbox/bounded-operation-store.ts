/**
 * M6 control-plane persistence for bounded-operation tasks and steps.
 * Work state only. Never Identity, Mind State, or Recall. Not a resume engine.
 */

import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import type { M6StepRecord, M6StopReason } from "@composer-assistant/sandbox-v2";
import { requestOperationalJobCancelByBoundedTask } from "./operational-job-store.js";

export type BoundedOperationTaskStatus =
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "deadline_exceeded"
  | "interrupted"
  | "outcome_unknown";

function nowIso(): string {
  return new Date().toISOString();
}

export function persistAdmittedBoundedOperation(
  db: DatabaseSync,
  input: {
    ownerId: string;
    taskId: string;
    projectId: string;
    workspaceId: string;
    origin: "owner_request" | "ashley_private_interest";
    objective: string;
    successCondition: string;
    failureCondition: string;
    admittedStepsJson: string;
    maxSteps: number;
    deadlineAtMs: number;
    originJobId?: string | null;
  },
): void {
  const createdAt = nowIso();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO bounded_operation_tasks (
       entity_uuid, data_classification, owner_id, task_id, project_id, workspace_id,
       origin, objective, success_condition, failure_condition, admitted_steps_json,
       max_steps, deadline_at_ms, status, stop_reason, steps_executed, cancel_requested,
       border_state, origin_job_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', NULL, 0, 0, 'none', ?, ?, ?)`,
  ).run(
    newEntityUuid(),
    classification,
    input.ownerId,
    input.taskId,
    input.projectId,
    input.workspaceId,
    input.origin,
    input.objective,
    input.successCondition,
    input.failureCondition,
    input.admittedStepsJson,
    input.maxSteps,
    input.deadlineAtMs,
    input.originJobId ?? null,
    createdAt,
    createdAt,
  );
}

export function requestBoundedOperationCancel(db: DatabaseSync, taskId: string): boolean {
  const result = db
    .prepare(
      `UPDATE bounded_operation_tasks
          SET cancel_requested = 1, updated_at = ?
        WHERE task_id = ? AND status IN ('admitted', 'running')`,
    )
    .run(nowIso(), taskId);
  if (result.changes > 0) {
    requestOperationalJobCancelByBoundedTask(db, taskId);
  }
  return result.changes > 0;
}

export function isBoundedOperationCancelRequested(db: DatabaseSync, taskId: string): boolean {
  const row = db
    .prepare(
      `SELECT cancel_requested AS cancelRequested FROM bounded_operation_tasks WHERE task_id = ?`,
    )
    .get(taskId) as { cancelRequested?: number } | undefined;
  return row?.cancelRequested === 1;
}

export function finalizeBoundedOperation(
  db: DatabaseSync,
  input: {
    ownerId: string;
    taskId: string;
    status: BoundedOperationTaskStatus;
    stopReason: M6StopReason;
    stepsExecuted: number;
    stepRecords: readonly M6StepRecord[];
    workspaceId?: string;
    skipStepInsert?: boolean;
  },
): void {
  const updatedAt = nowIso();
  if (input.workspaceId) {
    db.prepare(
      `UPDATE bounded_operation_tasks
          SET status = ?, stop_reason = ?, steps_executed = ?, workspace_id = ?, updated_at = ?
        WHERE task_id = ?`,
    ).run(input.status, input.stopReason, input.stepsExecuted, input.workspaceId, updatedAt, input.taskId);
  } else {
    db.prepare(
      `UPDATE bounded_operation_tasks
          SET status = ?, stop_reason = ?, steps_executed = ?, updated_at = ?
        WHERE task_id = ?`,
    ).run(input.status, input.stopReason, input.stepsExecuted, updatedAt, input.taskId);
  }

  if (input.skipStepInsert) return;

  const classification = defaultUnclassifiedConversational();
  const insert = db.prepare(
    `INSERT INTO bounded_operation_steps (
       entity_uuid, data_classification, owner_id, task_id, step_index, step_kind,
       operation, outcome, error, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of input.stepRecords) {
    insert.run(
      newEntityUuid(),
      classification,
      input.ownerId,
      input.taskId,
      record.index,
      record.kind,
      record.operation ?? null,
      record.outcome,
      record.error ?? null,
      updatedAt,
    );
  }
}

export function getBoundedOperationStatus(
  db: DatabaseSync,
  taskId: string,
): { status: string; stopReason: string | null; cancelRequested: number } | null {
  const row = db
    .prepare(
      `SELECT status, stop_reason AS stopReason, cancel_requested AS cancelRequested
         FROM bounded_operation_tasks WHERE task_id = ?`,
    )
    .get(taskId) as
    | { status: string; stopReason: string | null; cancelRequested: number }
    | undefined;
  return row ?? null;
}

export type DurableStepRunStatus =
  | "declared"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "skipped"
  | "outcome_unknown";

export type DurableStepRow = {
  stepIndex: number;
  stepKind: string;
  operation: string | null;
  childTaskId: string | null;
  causationKey: string | null;
  stepRunStatus: DurableStepRunStatus | null;
  effectRefKind: string | null;
  effectRefId: string | null;
  effectFactsJson: string | null;
  outcome: string | null;
  error: string | null;
};

export function getBoundedOperationTaskRow(
  db: DatabaseSync,
  taskId: string,
): {
  ownerId: string;
  projectId: string;
  workspaceId: string;
  admittedStepsJson: string;
  maxSteps: number;
  deadlineAtMs: number;
  originJobId: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT owner_id AS ownerId, project_id AS projectId, workspace_id AS workspaceId,
              admitted_steps_json AS admittedStepsJson, max_steps AS maxSteps,
              deadline_at_ms AS deadlineAtMs, origin_job_id AS originJobId
         FROM bounded_operation_tasks WHERE task_id = ?`,
    )
    .get(taskId) as
    | {
        ownerId: string;
        projectId: string;
        workspaceId: string;
        admittedStepsJson: string;
        maxSteps: number;
        deadlineAtMs: number;
        originJobId: string | null;
      }
    | undefined;
  return row ?? null;
}

export function getDurableStep(
  db: DatabaseSync,
  taskId: string,
  stepIndex: number,
): DurableStepRow | null {
  const row = db
    .prepare(
      `SELECT step_index AS stepIndex, step_kind AS stepKind, operation,
              child_task_id AS childTaskId, causation_key AS causationKey,
              step_run_status AS stepRunStatus, effect_ref_kind AS effectRefKind,
              effect_ref_id AS effectRefId, effect_facts_json AS effectFactsJson,
              outcome, error
         FROM bounded_operation_steps WHERE task_id = ? AND step_index = ?`,
    )
    .get(taskId, stepIndex) as DurableStepRow | undefined;
  return row ?? null;
}

export function listDurableSteps(db: DatabaseSync, taskId: string): DurableStepRow[] {
  return db
    .prepare(
      `SELECT step_index AS stepIndex, step_kind AS stepKind, operation,
              child_task_id AS childTaskId, causation_key AS causationKey,
              step_run_status AS stepRunStatus, effect_ref_kind AS effectRefKind,
              effect_ref_id AS effectRefId, effect_facts_json AS effectFactsJson,
              outcome, error
         FROM bounded_operation_steps WHERE task_id = ? ORDER BY step_index ASC`,
    )
    .all(taskId) as DurableStepRow[];
}

export function declareDurableStep(
  db: DatabaseSync,
  input: {
    ownerId: string;
    taskId: string;
    stepIndex: number;
    stepKind: string;
    operation: string | null;
    childTaskId: string;
    causationKey: string;
    leaseGeneration: number;
  },
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO bounded_operation_steps (
       entity_uuid, data_classification, owner_id, task_id, step_index, step_kind,
       operation, outcome, error, recorded_at, child_task_id, causation_key,
       step_run_status, declared_at, declared_lease_generation
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', NULL, ?, ?, ?, 'declared', ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    input.ownerId,
    input.taskId,
    input.stepIndex,
    input.stepKind,
    input.operation,
    now,
    input.childTaskId,
    input.causationKey,
    now,
    input.leaseGeneration,
  );
}

export function markDurableStepInFlight(db: DatabaseSync, taskId: string, stepIndex: number): void {
  db.prepare(
    `UPDATE bounded_operation_steps
        SET step_run_status = 'in_flight', started_at = ?
      WHERE task_id = ? AND step_index = ? AND step_run_status = 'declared'`,
  ).run(nowIso(), taskId, stepIndex);
}

export function settleDurableStep(
  db: DatabaseSync,
  input: {
    taskId: string;
    stepIndex: number;
    stepRunStatus: Exclude<DurableStepRunStatus, "declared" | "in_flight">;
    outcome: "succeeded" | "failed" | "skipped";
    error?: string | null;
    effectRefKind?: string | null;
    effectRefId?: string | null;
    effectFactsJson?: string | null;
    derivedLicenseJson?: string | null;
  },
): void {
  db.prepare(
    `UPDATE bounded_operation_steps
        SET step_run_status = ?, outcome = ?, error = ?, settled_at = ?,
            effect_ref_kind = ?, effect_ref_id = ?, effect_facts_json = ?,
            derived_license_json = ?, derived_license_schema_version = 1
      WHERE task_id = ? AND step_index = ?`,
  ).run(
    input.stepRunStatus,
    input.outcome,
    input.error ?? null,
    nowIso(),
    input.effectRefKind ?? null,
    input.effectRefId ?? null,
    input.effectFactsJson ?? null,
    input.derivedLicenseJson ?? null,
    input.taskId,
    input.stepIndex,
  );
}

export function markBoundedOperationRunning(db: DatabaseSync, taskId: string): void {
  db.prepare(
    `UPDATE bounded_operation_tasks SET status = 'running', updated_at = ? WHERE task_id = ? AND status = 'admitted'`,
  ).run(nowIso(), taskId);
}


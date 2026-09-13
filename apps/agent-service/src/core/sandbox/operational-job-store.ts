/**
 * Durable operational-job envelope store.
 * Owns identity, lifecycle, fencing, cancel flag, and reporting enqueue.
 * Does not own sandbox effects.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

export type OperationalJobStatus =
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "deadline_exceeded"
  | "outcome_unknown";

export type OperationalJobPhase = "cognition_pending" | "execution_admitted" | "terminal";

export type OperationalCognitionState =
  | "not_required"
  | "pending"
  | "running"
  | "waiting_retry"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export type OperationalJobRow = {
  jobId: string;
  ownerId: string;
  sourceMessageEntityUuid: string;
  sourceUserMessageId: number | null;
  admissionReservationId: number;
  boundedOperationTaskId: string | null;
  projectId: string | null;
  status: OperationalJobStatus;
  jobPhase: OperationalJobPhase;
  cognitionState: OperationalCognitionState;
  thoughtAttemptCount: number;
  nextThoughtAttemptAtMs: number | null;
  lastThoughtErrorClass: string | null;
  cognitionExpiresAtMs: number | null;
  normalizedThoughtJson: string | null;
  normalizedThoughtSchemaVersion: number | null;
  thoughtAttentionRequestId: number | null;
  thoughtAttentionAttemptIdsJson: string | null;
  cancelRequested: boolean;
  currentStepIndex: number;
  lifetimeExpiresAtMs: number;
  runnerOwnerToken: string | null;
  runnerLeaseGeneration: number;
  runnerLeaseUntilMs: number | null;
  stopReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const LEASE_MS = 30_000;

function nowIso(): string {
  return new Date().toISOString();
}

export function mintOperationalJobId(): string {
  return `doj_${randomBytes(8).toString("hex")}`;
}

function mintJobId(): string {
  return mintOperationalJobId();
}

function mintToken(): string {
  return randomBytes(16).toString("hex");
}

function mapRow(row: Record<string, unknown>): OperationalJobRow {
  return {
    jobId: String(row.job_id),
    ownerId: String(row.owner_id),
    sourceMessageEntityUuid: String(row.source_message_entity_uuid),
    sourceUserMessageId:
      row.source_user_message_id == null ? null : Number(row.source_user_message_id),
    admissionReservationId: Number(row.admission_reservation_id),
    boundedOperationTaskId:
      row.bounded_operation_task_id == null
        ? null
        : String(row.bounded_operation_task_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    status: String(row.status) as OperationalJobStatus,
    jobPhase: String(row.job_phase ?? "execution_admitted") as OperationalJobPhase,
    cognitionState: String(
      row.cognition_state ?? "not_required",
    ) as OperationalCognitionState,
    thoughtAttemptCount: Number(row.thought_attempt_count ?? 0),
    nextThoughtAttemptAtMs:
      row.next_thought_attempt_at_ms == null
        ? null
        : Number(row.next_thought_attempt_at_ms),
    lastThoughtErrorClass:
      row.last_thought_error_class == null ? null : String(row.last_thought_error_class),
    cognitionExpiresAtMs:
      row.cognition_expires_at_ms == null ? null : Number(row.cognition_expires_at_ms),
    normalizedThoughtJson:
      row.normalized_thought_json == null ? null : String(row.normalized_thought_json),
    normalizedThoughtSchemaVersion:
      row.normalized_thought_schema_version == null
        ? null
        : Number(row.normalized_thought_schema_version),
    thoughtAttentionRequestId:
      row.thought_attention_request_id == null
        ? null
        : Number(row.thought_attention_request_id),
    thoughtAttentionAttemptIdsJson:
      row.thought_attention_attempt_ids_json == null
        ? null
        : String(row.thought_attention_attempt_ids_json),
    cancelRequested: Number(row.cancel_requested) === 1,
    currentStepIndex: Number(row.current_step_index),
    lifetimeExpiresAtMs: Number(row.lifetime_expires_at_ms),
    runnerOwnerToken:
      row.runner_owner_token == null ? null : String(row.runner_owner_token),
    runnerLeaseGeneration: Number(row.runner_lease_generation),
    runnerLeaseUntilMs:
      row.runner_lease_until_ms == null ? null : Number(row.runner_lease_until_ms),
    stopReason: row.stop_reason == null ? null : String(row.stop_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const SELECT_SQL = `SELECT * FROM operational_jobs WHERE job_id = ?`;

export function getOperationalJob(
  db: DatabaseSync,
  jobId: string,
): OperationalJobRow | null {
  const row = db.prepare(SELECT_SQL).get(jobId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getOperationalJobBySourceMessage(
  db: DatabaseSync,
  ownerId: string,
  sourceMessageEntityUuid: string,
): OperationalJobRow | null {
  const row = db
    .prepare(
      `SELECT * FROM operational_jobs WHERE owner_id = ? AND source_message_entity_uuid = ?`,
    )
    .get(ownerId, sourceMessageEntityUuid) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function insertAdmittedOperationalJob(
  db: DatabaseSync,
  input: {
    ownerId: string;
    sourceMessageEntityUuid: string;
    sourceUserMessageId: number | null;
    admissionReservationId: number;
    boundedOperationTaskId: string;
    projectId: string;
    lifetimeExpiresAtMs: number;
    jobId?: string;
  },
): OperationalJobRow {
  if (!input.projectId) {
    throw new Error("project_id_required");
  }
  const createdAt = nowIso();
  const jobId = input.jobId ?? mintJobId();
  db.prepare(
    `INSERT INTO operational_jobs (
       entity_uuid, data_classification, job_id, owner_id, source_message_entity_uuid,
       source_user_message_id, admission_reservation_id, bounded_operation_task_id,
       project_id, status, cancel_requested, current_step_index, lifetime_expires_at_ms,
       runner_lease_generation, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', 0, 0, ?, 0, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    jobId,
    input.ownerId,
    input.sourceMessageEntityUuid,
    input.sourceUserMessageId,
    input.admissionReservationId,
    input.boundedOperationTaskId,
    input.projectId,
    input.lifetimeExpiresAtMs,
    createdAt,
    createdAt,
  );
  const row = getOperationalJob(db, jobId);
  if (!row) throw new Error("operational_job_insert_lost");
  return row;
}

export function insertCognitionPendingOperationalJob(
  db: DatabaseSync,
  input: {
    ownerId: string;
    sourceMessageEntityUuid: string;
    sourceUserMessageId: number | null;
    admissionReservationId: number;
    cognitionExpiresAtMs: number;
    lifetimeExpiresAtMs: number;
    jobId?: string;
  },
): OperationalJobRow {
  const createdAt = nowIso();
  const jobId = input.jobId ?? mintJobId();
  db.prepare(
    `INSERT INTO operational_jobs (
       entity_uuid, data_classification, job_id, owner_id, source_message_entity_uuid,
       source_user_message_id, admission_reservation_id, bounded_operation_task_id,
       project_id, status, job_phase, cognition_state, thought_attempt_count,
       cognition_expires_at_ms, cancel_requested, current_step_index,
       lifetime_expires_at_ms, runner_lease_generation, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'admitted', 'cognition_pending',
       'pending', 0, ?, 0, 0, ?, 0, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    jobId,
    input.ownerId,
    input.sourceMessageEntityUuid,
    input.sourceUserMessageId,
    input.admissionReservationId,
    input.cognitionExpiresAtMs,
    input.lifetimeExpiresAtMs,
    createdAt,
    createdAt,
  );
  const row = getOperationalJob(db, jobId);
  if (!row) throw new Error("operational_job_insert_lost");
  return row;
}

export function requestOperationalJobCancel(db: DatabaseSync, jobId: string): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET cancel_requested = 1, cancel_requested_at = ?, updated_at = ?
        WHERE job_id = ? AND status IN ('admitted', 'running')`,
    )
    .run(nowIso(), nowIso(), jobId);
  return result.changes > 0;
}

export type ClaimResult =
  | { ok: true; job: OperationalJobRow; token: string; generation: number }
  | { ok: false };

export function claimOperationalJob(
  db: DatabaseSync,
  jobId: string,
  nowMs: number,
  leaseMs: number = LEASE_MS,
): ClaimResult {
  const token = mintToken();
  const until = nowMs + leaseMs;
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET runner_owner_token = ?,
              runner_lease_generation = runner_lease_generation + 1,
              runner_lease_until_ms = ?,
              status = 'running',
              updated_at = ?
        WHERE job_id = ?
          AND status IN ('admitted', 'running')
          AND cancel_requested = 0
          AND (runner_owner_token IS NULL OR runner_lease_until_ms IS NULL OR runner_lease_until_ms < ?)`,
    )
    .run(token, until, nowIso(), jobId, nowMs);
  if (result.changes !== 1) return { ok: false };
  const job = getOperationalJob(db, jobId);
  if (!job || job.runnerOwnerToken !== token) return { ok: false };
  return { ok: true, job, token, generation: job.runnerLeaseGeneration };
}

export function findClaimableOperationalJob(
  db: DatabaseSync,
  nowMs: number,
): OperationalJobRow | null {
  const row = db
    .prepare(
      `SELECT * FROM operational_jobs
        WHERE status IN ('admitted', 'running')
          AND cancel_requested = 0
          AND job_phase = 'execution_admitted'
          AND bounded_operation_task_id IS NOT NULL
          AND (status = 'admitted'
               OR runner_owner_token IS NULL
               OR runner_lease_until_ms IS NULL
               OR runner_lease_until_ms < ?)
        ORDER BY created_at ASC
        LIMIT 1`,
    )
    .get(nowMs) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function renewOperationalJobLease(
  db: DatabaseSync,
  input: { jobId: string; token: string; generation: number; nowMs: number; leaseMs?: number },
): boolean {
  const until = input.nowMs + (input.leaseMs ?? LEASE_MS);
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET runner_lease_until_ms = ?, updated_at = ?
        WHERE job_id = ?
          AND runner_owner_token = ?
          AND runner_lease_generation = ?
          AND status = 'running'`,
    )
    .run(until, nowIso(), input.jobId, input.token, input.generation);
  return result.changes === 1;
}

export function assertOperationalJobFence(
  db: DatabaseSync,
  input: { jobId: string; token: string; generation: number },
): boolean {
  const job = getOperationalJob(db, input.jobId);
  return (
    job !== null &&
    job.status === "running" &&
    job.runnerOwnerToken === input.token &&
    job.runnerLeaseGeneration === input.generation
  );
}

export function setOperationalJobStepIndex(
  db: DatabaseSync,
  input: { jobId: string; token: string; generation: number; stepIndex: number },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET current_step_index = ?, updated_at = ?
        WHERE job_id = ?
          AND runner_owner_token = ?
          AND runner_lease_generation = ?
          AND status = 'running'`,
    )
    .run(input.stepIndex, nowIso(), input.jobId, input.token, input.generation);
  return result.changes === 1;
}

export function terminalizeOperationalJob(
  db: DatabaseSync,
  input: {
    jobId: string;
    token: string;
    generation: number;
    status: Exclude<OperationalJobStatus, "admitted" | "running">;
    stopReason: string;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET status = ?, stop_reason = ?, runner_owner_token = NULL, updated_at = ?
        WHERE job_id = ?
          AND runner_owner_token = ?
          AND runner_lease_generation = ?
          AND status = 'running'`,
    )
    .run(input.status, input.stopReason, nowIso(), input.jobId, input.token, input.generation);
  return result.changes === 1;
}

export function listTerminalJobsMissingCompletion(
  db: DatabaseSync,
): OperationalJobRow[] {
  const rows = db
    .prepare(
      `SELECT j.* FROM operational_jobs j
        WHERE j.status IN ('succeeded', 'failed', 'cancelled', 'deadline_exceeded', 'outcome_unknown')
          AND NOT EXISTS (
            SELECT 1 FROM operational_job_deliveries d
             WHERE d.job_id = j.job_id AND d.delivery_kind = 'completion'
          )`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function tryEnqueueOperationalJobDelivery(
  db: DatabaseSync,
  input: {
    jobId: string;
    deliveryKind: "ack" | "completion";
    deliveryReservationId: number;
  },
): boolean {
  try {
    db.prepare(
      `INSERT INTO operational_job_deliveries (
         entity_uuid, data_classification, job_id, delivery_kind, delivery_reservation_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      newEntityUuid(),
      defaultUnclassifiedConversational(),
      input.jobId,
      input.deliveryKind,
      input.deliveryReservationId,
      nowIso(),
    );
    return true;
  } catch {
    return false;
  }
}

export function getOperationalJobDelivery(
  db: DatabaseSync,
  jobId: string,
  deliveryKind: "ack" | "completion",
): { deliveryReservationId: number } | null {
  const row = db
    .prepare(
      `SELECT delivery_reservation_id AS deliveryReservationId
         FROM operational_job_deliveries
        WHERE job_id = ? AND delivery_kind = ?`,
    )
    .get(jobId, deliveryKind) as { deliveryReservationId?: number } | undefined;
  if (!row || row.deliveryReservationId == null) return null;
  return { deliveryReservationId: Number(row.deliveryReservationId) };
}

export function bindOperationalJobDeliveryReservation(
  db: DatabaseSync,
  input: {
    jobId: string;
    deliveryKind: "ack" | "completion";
    deliveryReservationId: number;
  },
): boolean {
  if (input.deliveryReservationId <= 0) return false;
  const result = db
    .prepare(
      `UPDATE operational_job_deliveries
          SET delivery_reservation_id = ?
        WHERE job_id = ?
          AND delivery_kind = ?
          AND delivery_reservation_id = 0`,
    )
    .run(input.deliveryReservationId, input.jobId, input.deliveryKind);
  return result.changes === 1;
}

export function listOperationalCompletionsAwaitingDraft(
  db: DatabaseSync,
): OperationalJobRow[] {
  const rows = db
    .prepare(
      `SELECT j.*
         FROM operational_jobs j
          JOIN operational_job_deliveries d
            ON d.job_id = j.job_id AND d.delivery_kind = 'completion'
          LEFT JOIN delivery_reservations r
            ON r.id = d.delivery_reservation_id
         WHERE j.status IN ('succeeded', 'failed', 'cancelled', 'deadline_exceeded', 'outcome_unknown')
           AND (
             d.delivery_reservation_id = 0
             OR r.id IS NULL
             OR (r.state = 'aborted' AND r.finalization_reason = 'send_failure' AND r.first_sent_at IS NULL)
           )`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function hasActiveOperationalJobForOwner(
  db: DatabaseSync,
  ownerId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM operational_jobs
        WHERE owner_id = ? AND status IN ('admitted', 'running') LIMIT 1`,
    )
    .get(ownerId) as { ok?: number } | undefined;
  return row !== undefined;
}

export function requestOperationalJobCancelByBoundedTask(
  db: DatabaseSync,
  boundedOperationTaskId: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET cancel_requested = 1, cancel_requested_at = ?, updated_at = ?
        WHERE bounded_operation_task_id = ?
          AND status IN ('admitted', 'running')`,
    )
    .run(nowIso(), nowIso(), boundedOperationTaskId);
  return result.changes > 0;
}

export function terminalizeUnclaimedCancelledJob(
  db: DatabaseSync,
  jobId: string,
  stopReason: string,
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET status = 'cancelled', stop_reason = ?, runner_owner_token = NULL, updated_at = ?
        WHERE job_id = ?
          AND status = 'admitted'
          AND cancel_requested = 1
          AND runner_owner_token IS NULL`,
    )
    .run(stopReason, nowIso(), jobId);
  return result.changes === 1;
}

export function listUnclaimedCancelledJobs(db: DatabaseSync): OperationalJobRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM operational_jobs
        WHERE status = 'admitted'
          AND cancel_requested = 1
          AND runner_owner_token IS NULL`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function listOperationalJobsForOwner(
  db: DatabaseSync,
  ownerId: string,
): OperationalJobRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM operational_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(ownerId) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function findClaimableCognitionJob(
  db: DatabaseSync,
  nowMs: number,
): OperationalJobRow | null {
  const row = db
    .prepare(
      `SELECT * FROM operational_jobs
        WHERE job_phase = 'cognition_pending'
          AND cognition_state IN ('pending', 'waiting_retry')
          AND cancel_requested = 0
          AND bounded_operation_task_id IS NULL
          AND (cognition_expires_at_ms IS NULL OR cognition_expires_at_ms > ?)
          AND (cognition_state = 'pending'
               OR next_thought_attempt_at_ms IS NULL
               OR next_thought_attempt_at_ms <= ?)
          AND (runner_owner_token IS NULL
               OR runner_lease_until_ms IS NULL
               OR runner_lease_until_ms < ?)
        ORDER BY created_at ASC
        LIMIT 1`,
    )
    .get(nowMs, nowMs, nowMs) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function claimCognitionJob(
  db: DatabaseSync,
  jobId: string,
  nowMs: number,
  leaseMs: number = LEASE_MS,
): ClaimResult {
  const token = mintToken();
  const until = nowMs + leaseMs;
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET runner_owner_token = ?,
              runner_lease_generation = runner_lease_generation + 1,
              runner_lease_until_ms = ?,
              cognition_state = 'running',
              thought_attempt_count = thought_attempt_count + 1,
              updated_at = ?
        WHERE job_id = ?
          AND job_phase = 'cognition_pending'
          AND cognition_state IN ('pending', 'waiting_retry')
          AND cancel_requested = 0
          AND bounded_operation_task_id IS NULL
          AND (runner_owner_token IS NULL OR runner_lease_until_ms IS NULL OR runner_lease_until_ms < ?)`,
    )
    .run(token, until, nowIso(), jobId, nowMs);
  if (result.changes !== 1) return { ok: false };
  const job = getOperationalJob(db, jobId);
  if (!job || job.runnerOwnerToken !== token) return { ok: false };
  return { ok: true, job, token, generation: job.runnerLeaseGeneration };
}

export function persistNormalizedThought(
  db: DatabaseSync,
  input: {
    jobId: string;
    token: string;
    generation: number;
    json: string;
    schemaVersion: number;
    attentionRequestId: number | null;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET normalized_thought_json = ?,
              normalized_thought_schema_version = ?,
              thought_attention_request_id = ?,
              cognition_state = 'succeeded',
              runner_owner_token = NULL,
              updated_at = ?
        WHERE job_id = ?
          AND runner_owner_token = ?
          AND runner_lease_generation = ?
          AND job_phase = 'cognition_pending'
          AND bounded_operation_task_id IS NULL`,
    )
    .run(
      input.json,
      input.schemaVersion,
      input.attentionRequestId,
      nowIso(),
      input.jobId,
      input.token,
      input.generation,
    );
  if (result.changes === 1 && input.attentionRequestId != null) {
    appendThoughtAttentionAttemptId(db, input.jobId, input.attentionRequestId);
  }
  return result.changes === 1;
}

export function scheduleCognitionRetry(
  db: DatabaseSync,
  input: {
    jobId: string;
    token: string;
    generation: number;
    nextAttemptAtMs: number;
    errorClass: string;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET cognition_state = 'waiting_retry',
              next_thought_attempt_at_ms = ?,
              last_thought_error_class = ?,
              runner_owner_token = NULL,
              updated_at = ?
        WHERE job_id = ?
          AND runner_owner_token = ?
          AND runner_lease_generation = ?
          AND job_phase = 'cognition_pending'`,
    )
    .run(
      input.nextAttemptAtMs,
      input.errorClass,
      nowIso(),
      input.jobId,
      input.token,
      input.generation,
    );
  return result.changes === 1;
}

export function attachBoundedOperationToCognitionJob(
  db: DatabaseSync,
  input: {
    jobId: string;
    boundedOperationTaskId: string;
    projectId: string;
    lifetimeExpiresAtMs: number;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET bounded_operation_task_id = ?,
              project_id = ?,
              job_phase = 'execution_admitted',
              cognition_state = 'succeeded',
              lifetime_expires_at_ms = ?,
              runner_owner_token = NULL,
              updated_at = ?
        WHERE job_id = ?
          AND job_phase = 'cognition_pending'
          AND bounded_operation_task_id IS NULL
          AND cancel_requested = 0`,
    )
    .run(
      input.boundedOperationTaskId,
      input.projectId,
      input.lifetimeExpiresAtMs,
      nowIso(),
      input.jobId,
    );
  return result.changes === 1;
}

export function terminalizeCognitionJob(
  db: DatabaseSync,
  input: {
    jobId: string;
    status: Exclude<OperationalJobStatus, "admitted" | "running">;
    cognitionState: Exclude<
      OperationalCognitionState,
      "pending" | "running" | "waiting_retry" | "not_required"
    >;
    stopReason: string;
    token?: string;
    generation?: number;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET status = ?,
              job_phase = 'terminal',
              cognition_state = ?,
              stop_reason = ?,
              runner_owner_token = NULL,
              updated_at = ?
        WHERE job_id = ?
          AND job_phase = 'cognition_pending'
          AND bounded_operation_task_id IS NULL
          AND (? IS NULL OR (runner_owner_token = ? AND runner_lease_generation = ?))`,
    )
    .run(
      input.status,
      input.cognitionState,
      input.stopReason,
      nowIso(),
      input.jobId,
      input.token ?? null,
      input.token ?? null,
      input.generation ?? 0,
    );
  return result.changes === 1;
}

function parseThoughtAttentionAttemptIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => typeof id === "number" && Number.isInteger(id));
  } catch {
    return [];
  }
}

function appendThoughtAttentionAttemptId(
  db: DatabaseSync,
  jobId: string,
  attentionRequestId: number,
): void {
  const row = db
    .prepare(
      `SELECT thought_attention_attempt_ids_json AS json
         FROM operational_jobs WHERE job_id = ?`,
    )
    .get(jobId) as { json?: string | null } | undefined;
  const ids = parseThoughtAttentionAttemptIds(row?.json ?? null);
  if (!ids.includes(attentionRequestId)) ids.push(attentionRequestId);
  db.prepare(
    `UPDATE operational_jobs
        SET thought_attention_attempt_ids_json = ?, updated_at = ?
      WHERE job_id = ?`,
  ).run(JSON.stringify(ids), nowIso(), jobId);
}

export function recordThoughtAttentionRequest(
  db: DatabaseSync,
  input: { jobId: string; attentionRequestId: number },
): boolean {
  const result = db
    .prepare(
      `UPDATE operational_jobs
          SET thought_attention_request_id = ?, updated_at = ?
        WHERE job_id = ? AND job_phase = 'cognition_pending'`,
    )
    .run(input.attentionRequestId, nowIso(), input.jobId);
  if (result.changes === 1) {
    appendThoughtAttentionAttemptId(db, input.jobId, input.attentionRequestId);
  }
  return result.changes === 1;
}

export type ThoughtAttentionAttempt = {
  attemptNumber: number;
  attentionRequestId: number;
  outcome: string | null;
  errorClass: string | null;
  queuedAt: string | null;
  endedAt: string | null;
};

export function listThoughtAttentionAttempts(
  db: DatabaseSync,
  jobId: string,
): ThoughtAttentionAttempt[] {
  const job = getOperationalJob(db, jobId);
  const ids = parseThoughtAttentionAttemptIds(job?.thoughtAttentionAttemptIdsJson ?? null);
  return ids.map((attentionRequestId, index) => {
    const row = db
      .prepare(
        `SELECT outcome, error_class AS errorClass, queued_at AS queuedAt, ended_at AS endedAt
           FROM attention_requests WHERE id = ?`,
      )
      .get(attentionRequestId) as {
      outcome?: string | null;
      errorClass?: string | null;
      queuedAt?: string | null;
      endedAt?: string | null;
    } | undefined;
    return {
      attemptNumber: index + 1,
      attentionRequestId,
      outcome: row?.outcome ?? null,
      errorClass: row?.errorClass ?? null,
      queuedAt: row?.queuedAt ?? null,
      endedAt: row?.endedAt ?? null,
    };
  });
}

export function listExpiredCognitionJobs(
  db: DatabaseSync,
  nowMs: number,
): OperationalJobRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM operational_jobs
        WHERE job_phase = 'cognition_pending'
          AND cognition_state IN ('pending', 'waiting_retry', 'running')
          AND cognition_expires_at_ms IS NOT NULL
          AND cognition_expires_at_ms <= ?`,
    )
    .all(nowMs) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function findCognitionJobAwaitingAttach(
  db: DatabaseSync,
): OperationalJobRow | null {
  const row = db
    .prepare(
      `SELECT * FROM operational_jobs
        WHERE job_phase = 'cognition_pending'
          AND cognition_state = 'succeeded'
          AND normalized_thought_json IS NOT NULL
          AND bounded_operation_task_id IS NULL
          AND cancel_requested = 0
        ORDER BY created_at ASC
        LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

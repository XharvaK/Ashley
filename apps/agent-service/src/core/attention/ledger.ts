import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import {
  DECLARED_CONTRACT_ID,
  DECLARED_CONTRACT_VERSION,
  declaredContractHash,
} from "./contract-material.js";
import type { AttentionClock } from "./types.js";
import {
  realClock,
  RPS_WINDOW_MS,
  STARVATION_COGNITION_MS,
  STARVATION_CURIOSITY_MS,
  STARVATION_MAINTENANCE_MS,
  TPM_WINDOW_MS,
} from "./types.js";
import type {
  AttentionLane,
  AttentionOutcome,
  AttentionPurpose,
  AttentionState,
} from "./types.js";
import { quotaContractFor } from "../model-routing/router.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

export type EnqueueInput = {
  lane: AttentionLane;
  purpose: AttentionPurpose;
  modelAlias: string;
  /** Defaults to "mistral". */
  providerId?: string;
  /** Defaults to the legacy mistral:<env model> bucket. */
  quotaBucket?: string;
  routeAlias?: string | null;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  deadlineAtMs?: number | null;
  eligibleAtMs?: number;
  ageOriginAtMs?: number;
  deliveryReservationId?: number | null;
  decisionId?: number | null;
  cognitiveJobId?: number | null;
  ownerId?: string | null;
};

export type ThoughtAttemptBinding = {
  allocationId: number;
  thoughtInvocationId: string;
  thoughtCycleId: string;
  thoughtGeneration: number;
  thoughtSemanticPass: number;
  thoughtStructuralAttempt: number;
  thoughtAuthorityEpoch: number;
  thoughtAuthorityVectorJson: string;
  thoughtTriggerRef: string;
  semanticProjectionHash: string;
  dispatchMessagesHash: string;
  allowlistFingerprint: string;
  mfInvocationId: string;
  mfAttemptId: string;
  actualProvider: string;
  actualOccupantId: string;
  actualWireBindingId: string;
  schemaEnforcementMode: string;
  resourcePolicyFingerprint: string;
  absoluteDeadlineAtMs: number;
};

/** Default bucket for legacy callers until the router supplies routes. */
export function defaultQuotaBucket(): string {
  return `mistral:${env.mistralModel}`;
}

export function ensureBootstrapContract(db: DatabaseSync): void {
  const hash = declaredContractHash();
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT contract_id, version, spec_hash, active FROM capability_contracts WHERE active = 1`)
    .get();
  if (!isRow(existing)) {
    db.prepare(
      `INSERT INTO capability_contracts (contract_id, version, spec_hash, created_at, active)
       VALUES (?, ?, ?, ?, 1)`,
    ).run(DECLARED_CONTRACT_ID, DECLARED_CONTRACT_VERSION, hash, now);
    return;
  }
  // Never silently rewrite an active hash. Mismatch is observed at influence time.
  if (String(existing.spec_hash) === "pending-bootstrap") {
    db.prepare(
      `UPDATE capability_contracts SET spec_hash = ? WHERE contract_id = ? AND active = 1`,
    ).run(hash, existing.contract_id);
  }
}

export function contractMismatch(db: DatabaseSync): boolean {
  ensureBootstrapContract(db);
  const active = db
    .prepare(
      `SELECT contract_id, version, spec_hash FROM capability_contracts WHERE active = 1`,
    )
    .get();
  if (!isRow(active)) return true;
  return (
    String(active.contract_id) !== DECLARED_CONTRACT_ID ||
    String(active.version) !== DECLARED_CONTRACT_VERSION ||
    String(active.spec_hash) !== declaredContractHash()
  );
}

/** Read-only contract check for diagnostics and other non-mutating surfaces. */
export function contractMismatchReadOnly(db: DatabaseSync): boolean {
  const active = db
    .prepare(
      `SELECT contract_id, version, spec_hash FROM capability_contracts WHERE active = 1`,
    )
    .get();
  if (!isRow(active)) return true;
  return (
    String(active.contract_id) !== DECLARED_CONTRACT_ID ||
    String(active.version) !== DECLARED_CONTRACT_VERSION ||
    String(active.spec_hash) !== declaredContractHash()
  );
}

export function insertQueuedRequest(
  db: DatabaseSync,
  input: EnqueueInput,
  clock: AttentionClock = realClock,
): number {
  const nowMs = clock.nowMs();
  const nowIso = new Date(nowMs).toISOString();
  const eligibleAt = new Date(input.eligibleAtMs ?? nowMs).toISOString();
  const ageOriginAt = new Date(input.ageOriginAtMs ?? nowMs).toISOString();
  const deadlineAt =
    input.deadlineAtMs != null
      ? new Date(input.deadlineAtMs).toISOString()
      : null;
  const providerId = input.providerId ?? "mistral";
  const quotaBucket = input.quotaBucket ?? defaultQuotaBucket();
  const result = db
    .prepare(
      `INSERT INTO attention_requests
         (lane, purpose, model_alias, provider_id, route_alias, quota_bucket,
          state, outcome, error_class,
          queued_at, eligible_at, age_origin_at, deadline_at,
          estimated_input_tokens, estimated_output_tokens,
          delivery_reservation_id, decision_id, cognitive_job_id, owner_id,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.lane,
      input.purpose,
      input.modelAlias,
      providerId,
      input.routeAlias ?? null,
      quotaBucket,
      nowIso,
      eligibleAt,
      ageOriginAt,
      deadlineAt,
      input.estimatedInputTokens,
      input.estimatedOutputTokens,
      input.deliveryReservationId ?? null,
      input.decisionId ?? null,
      input.cognitiveJobId ?? null,
      input.ownerId ?? null,
      nowIso,
    );
  return Number(result.lastInsertRowid);
}

export function terminalizeRequest(
  db: DatabaseSync,
  requestId: number,
  outcome: AttentionOutcome,
  errorClass: string | null,
  clock: AttentionClock = realClock,
  options: { retainBudgetUntilMs?: number | null } = {},
): void {
  const ended = new Date(clock.nowMs()).toISOString();
  const retain =
    options.retainBudgetUntilMs != null
      ? new Date(options.retainBudgetUntilMs).toISOString()
      : null;
  db.prepare(
    `UPDATE attention_requests
     SET state = 'terminal', outcome = ?, error_class = ?, ended_at = ?,
         budget_retain_until = COALESCE(?, budget_retain_until)
     WHERE id = ? AND state != 'terminal'`,
  ).run(outcome, errorClass, ended, retain, requestId);
}

function tokensInWindow(
  db: DatabaseSync,
  windowStartIso: string,
  nowIso: string,
  quotaBucket: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN state IN ('reserved', 'running')
             THEN reserved_input_tokens + reserved_output_tokens
           WHEN state = 'terminal'
                AND actual_input_tokens IS NOT NULL
                AND dispatch_started_at IS NOT NULL
                AND dispatch_started_at >= ?
             THEN actual_input_tokens + COALESCE(actual_output_tokens, 0)
           WHEN state = 'terminal'
                AND budget_retain_until IS NOT NULL
                AND budget_retain_until > ?
             THEN reserved_input_tokens + reserved_output_tokens
           ELSE 0
         END
       ), 0) AS tokens
       FROM attention_requests
       WHERE quota_bucket = ?
         AND (
          (state IN ('reserved', 'running') AND reserved_at >= ?)
          OR (state = 'terminal' AND (
               (dispatch_started_at IS NOT NULL AND dispatch_started_at >= ?)
               OR (budget_retain_until IS NOT NULL AND budget_retain_until > ?)
             ))
         )`,
    )
    .get(
      windowStartIso,
      nowIso,
      quotaBucket,
      windowStartIso,
      windowStartIso,
      nowIso,
    );
  return isRow(row) ? Number(row.tokens ?? 0) : 0;
}

function rpsStartsInWindow(
  db: DatabaseSync,
  windowStartIso: string,
  quotaBucket: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attention_requests
       WHERE dispatch_started_at IS NOT NULL AND dispatch_started_at >= ?
         AND quota_bucket = ?
         AND state IN ('reserved', 'running', 'terminal')`,
    )
    .get(windowStartIso, quotaBucket);
  return isRow(row) ? Number(row.c ?? 0) : 0;
}

export function earliestLegalDispatchMs(
  db: DatabaseSync,
  demandTokens: number,
  clock: AttentionClock = realClock,
  quotaBucket: string = defaultQuotaBucket(),
): number {
  const now = clock.nowMs();
  let candidate = now;
  const contract = quotaContractFor(quotaBucket);
  const rpsLimit = contract.rps;
  const tpmLimit = contract.tpm;

  // RPS: if at capacity, wait until oldest dispatch leaves the 1s window.
  for (let i = 0; i < 8; i++) {
    const windowStart = new Date(candidate - RPS_WINDOW_MS + 1).toISOString();
    if (rpsStartsInWindow(db, windowStart, quotaBucket) < rpsLimit) break;
    const oldest = db
      .prepare(
        `SELECT dispatch_started_at FROM attention_requests
         WHERE dispatch_started_at IS NOT NULL AND dispatch_started_at >= ?
           AND quota_bucket = ?
         ORDER BY dispatch_started_at ASC LIMIT 1`,
      )
      .get(windowStart, quotaBucket);
    if (!isRow(oldest) || typeof oldest.dispatch_started_at !== "string") break;
    candidate = Date.parse(oldest.dispatch_started_at) + RPS_WINDOW_MS;
  }

  if (demandTokens > tpmLimit) {
    throw Object.assign(new Error("request_exceeds_tpm_budget"), {
      code: "request_exceeds_tpm_budget",
    });
  }

  const maxAdvanceSteps = Math.max(1, Math.ceil(TPM_WINDOW_MS / 1_000));
  for (let i = 0; i < maxAdvanceSteps; i++) {
    const windowStart = new Date(candidate - TPM_WINDOW_MS + 1).toISOString();
    const nowIso = new Date(candidate).toISOString();
    const used = tokensInWindow(db, windowStart, nowIso, quotaBucket);
    if (used + demandTokens <= tpmLimit) break;
    candidate += 1_000;
  }
  return candidate;
}

function overdueMs(
  lane: string,
  purpose: string,
  ageOriginMs: number,
  nowMs: number,
): number | null {
  const age = nowMs - ageOriginMs;
  if (lane === "exchange_cognition" && age >= STARVATION_COGNITION_MS) {
    return age - STARVATION_COGNITION_MS;
  }
  if (lane === "curiosity_maintenance") {
    const threshold =
      purpose === "curiosity_consolidation"
        ? STARVATION_CURIOSITY_MS
        : STARVATION_MAINTENANCE_MS;
    if (age >= threshold) return age - threshold;
  }
  return null;
}

/**
 * Locked scheduling order:
 * interactive → urgent → overdue background (oldest overdue) →
 * normal cognition → normal curiosity → normal maintenance.
 */
export function compareAttentionPriority(
  a: {
    lane: string;
    purpose: string;
    ageOriginAt: string;
    eligibleAt: string;
    id: number;
  },
  b: typeof a,
  nowMs: number,
): number {
  const tier = (row: typeof a): number => {
    if (row.lane === "interactive") return 0;
    if (row.lane === "urgent_grounded") return 1;
    const overdue = overdueMs(
      row.lane,
      row.purpose,
      Date.parse(row.ageOriginAt),
      nowMs,
    );
    if (overdue != null) return 2;
    if (row.lane === "exchange_cognition") return 3;
    if (row.purpose === "curiosity_consolidation") return 4;
    return 5;
  };
  const ta = tier(a);
  const tb = tier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 2) {
    const oa = overdueMs(a.lane, a.purpose, Date.parse(a.ageOriginAt), nowMs) ?? 0;
    const ob = overdueMs(b.lane, b.purpose, Date.parse(b.ageOriginAt), nowMs) ?? 0;
    if (oa !== ob) return ob - oa; // oldest overdue first
  }
  const ageA = Date.parse(a.ageOriginAt);
  const ageB = Date.parse(b.ageOriginAt);
  if (ageA !== ageB) return ageA - ageB;
  const elA = Date.parse(a.eligibleAt);
  const elB = Date.parse(b.eligibleAt);
  if (elA !== elB) return elA - elB;
  return a.id - b.id;
}

export function selectNextEligibleRequestId(
  db: DatabaseSync,
  clock: AttentionClock = realClock,
): number | null {
  const now = clock.nowMs();
  const nowIso = new Date(now).toISOString();
  const rows = db
    .prepare(
      `SELECT id, lane, purpose, age_origin_at, eligible_at, deadline_at
       FROM attention_requests
       WHERE state = 'queued' AND eligible_at <= ?
       ORDER BY id ASC`,
    )
    .all(nowIso) as Array<Row>;
  const candidates = rows
    .filter((row) => {
      if (typeof row.deadline_at === "string" && Date.parse(row.deadline_at) <= now) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      id: Number(row.id),
      lane: String(row.lane),
      purpose: String(row.purpose),
      ageOriginAt: String(row.age_origin_at),
      eligibleAt: String(row.eligible_at),
    }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compareAttentionPriority(a, b, now));
  return candidates[0]?.id ?? null;
}

/**
 * Atomically admit queued -> reserved when RPS/TPM allow and this request
 * is the highest-priority eligible work. Assigns DB-global dispatch_sequence.
 */
export function tryAdmitRequest(
  db: DatabaseSync,
  requestId: number,
  clock: AttentionClock = realClock,
): {
  admitted: boolean;
  dispatchSequence?: number;
  reason?: string;
  nextEligibleAtMs?: number;
} {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(`SELECT * FROM attention_requests WHERE id = ?`)
      .get(requestId);
    if (!isRow(row) || row.state !== "queued") {
      db.exec("COMMIT");
      return { admitted: false, reason: "not_queued" };
    }
    const now = clock.nowMs();
    if (
      typeof row.deadline_at === "string" &&
      Date.parse(row.deadline_at) <= now
    ) {
      const ended = new Date(now).toISOString();
      db.prepare(
        `UPDATE attention_requests
         SET state = 'terminal', outcome = 'timeout',
             error_class = 'deadline_before_dispatch', ended_at = ?
         WHERE id = ?`,
      ).run(ended, requestId);
      db.exec("COMMIT");
      return { admitted: false, reason: "deadline" };
    }

    const nextId = selectNextEligibleRequestId(db, clock);
    if (nextId !== requestId) {
      db.exec("COMMIT");
      return { admitted: false, reason: "preempted" };
    }

    const demand =
      Number(row.estimated_input_tokens ?? 0) +
      Number(row.estimated_output_tokens ?? 0);
    const bucket =
      typeof row.quota_bucket === "string" ? row.quota_bucket : defaultQuotaBucket();
    const deadline =
      typeof row.deadline_at === "string" ? Date.parse(row.deadline_at) : null;
    const earliest = earliestLegalDispatchMs(db, demand, clock, bucket);
    if (deadline != null && earliest >= deadline) {
      const ended = new Date(now).toISOString();
      db.prepare(
        `UPDATE attention_requests
         SET state = 'terminal', outcome = 'timeout', error_class = 'deadline_before_dispatch',
             ended_at = ?
         WHERE id = ?`,
      ).run(ended, requestId);
      db.exec("COMMIT");
      return { admitted: false, reason: "deadline", nextEligibleAtMs: earliest };
    }
    if (earliest > now) {
      db.exec("COMMIT");
      return { admitted: false, reason: "budget_wait", nextEligibleAtMs: earliest };
    }

    const seqRow = db
      .prepare(`SELECT next_seq FROM attention_dispatch_counter WHERE id = 1`)
      .get();
    const counterSequence = isRow(seqRow) ? Number(seqRow.next_seq) : 1;
    const ociSequenceRow = db
      .prepare(
        `SELECT COALESCE(MAX(generation_order), 0) AS generation_order
         FROM open_cognitive_items`,
      )
      .get();
    const maximumOciSequence = isRow(ociSequenceRow)
      ? Number(ociSequenceRow.generation_order ?? 0)
      : 0;
    const seq = Math.max(counterSequence, maximumOciSequence + 1);
    db.prepare(
      `UPDATE attention_dispatch_counter SET next_seq = ? WHERE id = 1`,
    ).run(seq + 1);

    const reservedAt = new Date(now).toISOString();
    const result = db
      .prepare(
        `UPDATE attention_requests
         SET state = 'reserved',
             reserved_at = ?,
             dispatch_sequence = ?,
             reserved_input_tokens = estimated_input_tokens,
             reserved_output_tokens = estimated_output_tokens
         WHERE id = ? AND state = 'queued'`,
      )
      .run(reservedAt, seq, requestId);
    db.exec("COMMIT");
    if (result.changes === 0) {
      return { admitted: false, reason: "lost_race" };
    }
    return { admitted: true, dispatchSequence: seq };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already closed / rolled back */
    }
    throw error;
  }
}

export function markRunning(
  db: DatabaseSync,
  requestId: number,
  clock: AttentionClock = realClock,
  acceptedProvenance?: {
    contractId: string;
    buildIdentity: string;
  },
): void {
  const started = new Date(clock.nowMs()).toISOString();
  db.prepare(
    `UPDATE attention_requests
     SET state = 'running', dispatch_started_at = ?,
         accepted_contract_id = ?, accepted_build_identity = ?
     WHERE id = ? AND state = 'reserved'`,
  ).run(
    started,
    acceptedProvenance?.contractId ?? null,
    acceptedProvenance?.buildIdentity ?? null,
    requestId,
  );
}

export function bindThoughtAttempt(
  db: DatabaseSync,
  input: ThoughtAttemptBinding,
): void {
  if (!Number.isInteger(input.allocationId) || input.allocationId <= 0) {
    throw new Error("thought_attempt_context_incomplete");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      `UPDATE attention_requests
          SET thought_invocation_id = ?, thought_cycle_id = ?, thought_generation = ?,
              thought_semantic_pass = ?, thought_structural_attempt = ?,
              thought_authority_epoch = ?, thought_authority_vector_json = ?,
              thought_trigger_ref = ?, semantic_projection_hash = ?,
              dispatch_messages_hash = ?, allowlist_fingerprint = ?,
              mf_invocation_id = ?, mf_attempt_id = ?, actual_provider = ?,
              actual_occupant_id = ?, actual_wire_binding_id = ?,
              schema_enforcement_mode = ?, resource_policy_fingerprint = ?,
              absolute_deadline_at_ms = ?
        WHERE id = ? AND mf_attempt_id IS NULL AND thought_invocation_id IS NULL`,
    ).run(
      input.thoughtInvocationId, input.thoughtCycleId, input.thoughtGeneration,
      input.thoughtSemanticPass, input.thoughtStructuralAttempt, input.thoughtAuthorityEpoch,
      input.thoughtAuthorityVectorJson, input.thoughtTriggerRef, input.semanticProjectionHash,
      input.dispatchMessagesHash, input.allowlistFingerprint, input.mfInvocationId,
      input.mfAttemptId, input.actualProvider, input.actualOccupantId, input.actualWireBindingId,
      input.schemaEnforcementMode, input.resourcePolicyFingerprint, input.absoluteDeadlineAtMs,
      input.allocationId,
    );
    if (result.changes !== 1) {
      const row = db.prepare(
        "SELECT id, state, thought_invocation_id, mf_attempt_id FROM attention_requests WHERE id = ?",
      ).get(input.allocationId) as Row | undefined;
      if (row && (row.thought_invocation_id != null || row.mf_attempt_id != null)) {
        throw new Error("thought_attempt_already_bound");
      }
      throw new Error("stale_attention_state");
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve binding error */ }
    throw error;
  }
}

export function getThoughtAttempt(db: DatabaseSync, allocationId: number): Row | undefined {
  return db.prepare(
    `SELECT id, thought_invocation_id, thought_cycle_id, thought_generation,
            thought_semantic_pass, thought_structural_attempt, thought_authority_epoch,
            thought_authority_vector_json, thought_trigger_ref, semantic_projection_hash,
            dispatch_messages_hash, allowlist_fingerprint, mf_invocation_id, mf_attempt_id,
            actual_provider, actual_occupant_id, actual_wire_binding_id,
            schema_enforcement_mode, resource_policy_fingerprint, absolute_deadline_at_ms
       FROM attention_requests WHERE id = ?`,
  ).get(allocationId) as Row | undefined;
}

export function completeRequest(
  db: DatabaseSync,
  requestId: number,
  input: {
    outcome: AttentionOutcome;
    errorClass?: string | null;
    resolvedModelId?: string | null;
    actualInput?: number | null;
    actualOutput?: number | null;
    retainUnknownBudget?: boolean;
  },
  clock: AttentionClock = realClock,
): void {
  const now = clock.nowMs();
  const ended = new Date(now).toISOString();
  const current = getRequest(db, requestId);
  if (!current || current.state === "terminal") return;

  // Queued cancel/timeout/abort: no TPM consumption.
  if (current.state === "queued") {
    db.prepare(
      `UPDATE attention_requests
       SET state = 'terminal', outcome = ?, error_class = ?, ended_at = ?,
           reserved_input_tokens = 0, reserved_output_tokens = 0,
           budget_retain_until = NULL
       WHERE id = ? AND state = 'queued'`,
    ).run(input.outcome, input.errorClass ?? null, ended, requestId);
    return;
  }

  const retainUntil = input.retainUnknownBudget
    ? (() => {
        const reservedAt =
          typeof current.reserved_at === "string"
            ? Date.parse(current.reserved_at)
            : now;
        return new Date(reservedAt + TPM_WINDOW_MS).toISOString();
      })()
    : null;
  db.prepare(
    `UPDATE attention_requests
     SET state = 'terminal',
         outcome = ?,
         error_class = ?,
         ended_at = ?,
         resolved_model_id = COALESCE(?, resolved_model_id),
         actual_input_tokens = ?,
         actual_output_tokens = ?,
         reserved_input_tokens = CASE
           WHEN ? IS NOT NULL THEN ?
           ELSE reserved_input_tokens
         END,
         reserved_output_tokens = CASE
           WHEN ? IS NOT NULL THEN ?
           ELSE reserved_output_tokens
         END,
         budget_retain_until = ?
     WHERE id = ? AND state IN ('reserved', 'running')`,
  ).run(
    input.outcome,
    input.errorClass ?? null,
    ended,
    input.resolvedModelId ?? null,
    input.actualInput ?? null,
    input.actualOutput ?? null,
    input.actualInput ?? null,
    input.actualInput ?? 0,
    input.actualOutput ?? null,
    input.actualOutput ?? 0,
    retainUntil,
    requestId,
  );
}

export function setRequestModelEpoch(
  db: DatabaseSync,
  requestId: number,
  modelEpoch: number,
): void {
  db.prepare(
    `UPDATE attention_requests
     SET model_epoch = ?
     WHERE id = ? AND state = 'terminal' AND outcome = 'completed'`,
  ).run(modelEpoch, requestId);
}

/** Rolling TPM currently counted (reserved/running + actual + crash-retained). */
export function currentTpmUsage(
  db: DatabaseSync,
  clock: AttentionClock = realClock,
  quotaBucket: string = defaultQuotaBucket(),
): number {
  const now = clock.nowMs();
  const windowStart = new Date(now - TPM_WINDOW_MS + 1).toISOString();
  const nowIso = new Date(now).toISOString();
  return tokensInWindow(db, windowStart, nowIso, quotaBucket);
}

export function pruneFoldedAttentionRequests(
  db: DatabaseSync,
  olderThanMs: number,
  clock: AttentionClock = realClock,
): number {
  const cutoff = new Date(clock.nowMs() - olderThanMs).toISOString();
  const result = db
    .prepare(
      `DELETE FROM attention_requests
       WHERE folded_at IS NOT NULL AND folded_at < ?`,
    )
    .run(cutoff);
  return Number(result.changes ?? 0);
}

export function recoverStaleRequests(
  db: DatabaseSync,
  clock: AttentionClock = realClock,
): number {
  const now = clock.nowMs();
  const nowIso = new Date(now).toISOString();
  const retainUntil = new Date(now + TPM_WINDOW_MS).toISOString();
  let count = 0;

  const queued = db
    .prepare(`SELECT id FROM attention_requests WHERE state = 'queued'`)
    .all() as Array<{ id: number }>;
  for (const row of queued) {
    terminalizeRequest(
      db,
      row.id,
      "aborted",
      "process_restart_before_dispatch",
      clock,
    );
    count += 1;
  }

  const inFlight = db
    .prepare(
      `SELECT id FROM attention_requests WHERE state IN ('reserved', 'running')`,
    )
    .all() as Array<{ id: number }>;
  for (const row of inFlight) {
    db.prepare(
      `UPDATE attention_requests
       SET state = 'terminal', outcome = 'error',
           error_class = 'unknown_after_restart',
           recovery_class = 'unknown_after_restart',
           ended_at = ?, budget_retain_until = ?
       WHERE id = ?`,
    ).run(nowIso, retainUntil, row.id);
    count += 1;
  }
  void nowIso;
  return count;
}

export function getRequest(
  db: DatabaseSync,
  requestId: number,
): Row | null {
  const row = db
    .prepare(`SELECT * FROM attention_requests WHERE id = ?`)
    .get(requestId);
  return isRow(row) ? row : null;
}

export type { AttentionState };

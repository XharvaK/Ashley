import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { stableJson } from "../../model-fabric/hash.js";
import type {
  AuthorityCurrentnessBinding,
  AuthorityVersionVector,
} from "../types.js";
import {
  authorityVersionVectorsEqual,
  canonicalizeAuthorityVersionVector,
  hasAuthorityBarrier,
  readAuthorityVersionVector,
} from "./version-vector.js";

export type AuthorityBarrierState = "stable" | "transitioning" | "reconciling";
export type CanonicalOwner = "nuclear" | "continuity" | "cognitive_sidecar";
export type { AuthorityVersionVector } from "../types.js";
export type AuthorityBarrierSnapshot = Readonly<{
  barrierId: "global";
  state: AuthorityBarrierState;
  epoch: number;
  revision: number;
  vector: AuthorityVersionVector;
  activeTransitionId: string | null;
  reasonCode: string | null;
}>;

export type AuthorityTransitionToken = AuthorityBarrierSnapshot & Readonly<{
  transitionId: string;
}>;

type BarrierRow = {
  barrier_id: string;
  state: AuthorityBarrierState;
  epoch: number;
  revision: number;
  vector_json: string;
  active_transition_id: string | null;
  reason_code: string | null;
};

function assertTime(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new Error("authority_barrier_time_invalid");
}

function row(db: DatabaseSync): BarrierRow {
  const value = db.prepare(
    `SELECT barrier_id, state, epoch, revision, vector_json,
            active_transition_id, reason_code
       FROM authority_transition_barrier WHERE barrier_id = 'global'`,
  ).get() as unknown as BarrierRow | undefined;
  if (!value) throw new Error("authority_barrier_missing");
  if (!Number.isInteger(Number(value.epoch)) || Number(value.epoch) < 0) {
    throw new Error("authority_barrier_epoch_invalid");
  }
  if (!Number.isInteger(Number(value.revision)) || Number(value.revision) < 0) {
    throw new Error("authority_barrier_revision_invalid");
  }
  return value;
}

function snapshot(value: BarrierRow): AuthorityBarrierSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.vector_json);
  } catch {
    throw new Error("authority_barrier_vector_invalid");
  }
  const vector = canonicalizeAuthorityVersionVector(parsed);
  return {
    barrierId: "global",
    state: value.state,
    epoch: Number(value.epoch),
    revision: Number(value.revision),
    vector,
    activeTransitionId: value.active_transition_id,
    reasonCode: value.reason_code,
  };
}

export function readAuthorityBarrier(db: DatabaseSync): AuthorityBarrierSnapshot {
  return snapshot(row(db));
}

export function captureAuthorityCurrentness(
  db: DatabaseSync,
): AuthorityCurrentnessBinding {
  const current = requireStableAuthorityBarrier(db);
  return {
    barrierId: "global",
    barrierEpoch: current.epoch,
    barrierRevision: current.revision,
    ownerVersions: current.vector,
  };
}

export function requireCurrentAuthorityBinding(
  db: DatabaseSync,
  expected: AuthorityCurrentnessBinding,
): AuthorityBarrierSnapshot {
  const current = requireStableAuthorityBarrier(db);
  if (
    current.epoch !== expected.barrierEpoch ||
    current.revision !== expected.barrierRevision ||
    !authorityVersionVectorsEqual(current.vector, expected.ownerVersions)
  ) {
    throw new Error("authority_vector_stale");
  }
  return current;
}

function requireStableExpected(
  current: AuthorityBarrierSnapshot,
  expected?: Pick<AuthorityBarrierSnapshot, "epoch" | "revision" | "vector">,
): void {
  if (current.state !== "stable") throw new Error("authority_barrier_not_stable");
  if (
    expected &&
    (current.epoch !== expected.epoch ||
      current.revision !== expected.revision ||
      !authorityVersionVectorsEqual(current.vector, expected.vector))
  ) {
    throw new Error("authority_barrier_vector_mismatch");
  }
}

function beginAuthorityTransitionInTransaction(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
  expected?: Pick<AuthorityBarrierSnapshot, "epoch" | "revision" | "vector">,
): AuthorityTransitionToken {
  if (!reasonCode.trim()) throw new Error("authority_transition_reason_missing");
  assertTime(nowMs);
  const current = readAuthorityBarrier(db);
  if (current.state === "transitioning") throw new Error("authority_transition_active");
  requireStableExpected(current, expected);
  const transitionId = `authority-transition:${randomUUID()}`;
  const result = db.prepare(
    `UPDATE authority_transition_barrier
        SET state = 'transitioning', epoch = epoch + 1, revision = revision + 1,
            active_transition_id = ?, reason_code = ?, updated_at_ms = ?
      WHERE barrier_id = 'global' AND state = 'stable'`,
  ).run(transitionId, reasonCode, nowMs);
  if (Number(result.changes) !== 1) throw new Error("authority_transition_active");
  return { ...readAuthorityBarrier(db), transitionId };
}

/** Begin one coordinator transition in its own immediate transaction. */
export function beginAuthorityTransition(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
  expected?: Pick<AuthorityBarrierSnapshot, "epoch" | "revision" | "vector">,
): AuthorityTransitionToken {
  db.exec("BEGIN IMMEDIATE");
  try {
    const started = beginAuthorityTransitionInTransaction(db, reasonCode, nowMs, expected);
    db.exec("COMMIT");
    return started;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

export function beginAuthorityTransitionInExistingTransaction(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
  expected?: Pick<AuthorityBarrierSnapshot, "epoch" | "revision" | "vector">,
): AuthorityTransitionToken {
  return beginAuthorityTransitionInTransaction(db, reasonCode, nowMs, expected);
}

function stabilizeInTransaction(
  db: DatabaseSync,
  vector: AuthorityVersionVector,
  nowMs: number,
  transitionId?: string,
): AuthorityBarrierSnapshot {
  assertTime(nowMs);
  const normalized = canonicalizeAuthorityVersionVector(vector);
  const current = readAuthorityBarrier(db);
  if (current.state !== "reconciling" && current.state !== "transitioning") {
    throw new Error("authority_barrier_already_stable");
  }
  if (transitionId && current.activeTransitionId !== transitionId) {
    throw new Error("authority_transition_token_mismatch");
  }
  db.prepare(
    `UPDATE authority_transition_barrier
        SET state = 'stable', vector_json = ?, active_transition_id = NULL,
            reason_code = NULL, updated_at_ms = ?
      WHERE barrier_id = 'global'`,
  ).run(stableJson(normalized), nowMs);
  return readAuthorityBarrier(db);
}

/** Mark the coordinator stable only after the supplied owner vector is known. */
export function stabilizeAuthorityBarrier(
  db: DatabaseSync,
  vector: AuthorityVersionVector,
  nowMs: number,
  transitionId?: string,
): AuthorityBarrierSnapshot {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = stabilizeInTransaction(db, vector, nowMs, transitionId);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

export function stabilizeAuthorityBarrierInExistingTransaction(
  db: DatabaseSync,
  vector: AuthorityVersionVector,
  nowMs: number,
  transitionId?: string,
): AuthorityBarrierSnapshot {
  return stabilizeInTransaction(db, vector, nowMs, transitionId);
}

function markReconcilingInTransaction(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
): AuthorityBarrierSnapshot {
  if (!reasonCode.trim()) throw new Error("authority_reconcile_reason_missing");
  assertTime(nowMs);
  const current = readAuthorityBarrier(db);
  if (current.state === "stable") throw new Error("authority_barrier_reconcile_source_invalid");
  const result = db.prepare(
    `UPDATE authority_transition_barrier
        SET state = 'reconciling', reason_code = ?, updated_at_ms = ?
      WHERE barrier_id = 'global' AND state IN ('transitioning', 'reconciling')`,
  ).run(reasonCode, nowMs);
  if (Number(result.changes) !== 1) throw new Error("authority_barrier_reconcile_conflict");
  return readAuthorityBarrier(db);
}

export function markAuthorityBarrierReconciling(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
): AuthorityBarrierSnapshot {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = markReconcilingInTransaction(db, reasonCode, nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

export function markAuthorityBarrierReconcilingInExistingTransaction(
  db: DatabaseSync,
  reasonCode: string,
  nowMs: number,
): AuthorityBarrierSnapshot {
  return markReconcilingInTransaction(db, reasonCode, nowMs);
}

/**
 * Startup recovery closes a migration/crash gap from canonical owner rows.
 * A pending invalidation keeps the barrier reconciling unless the caller has
 * proved that the derived projection has been reconciled.
 */
export function reconcileAuthorityBarrierOnStartup(
  db: DatabaseSync,
  options: { projectionReady?: boolean; nowMs?: number } = {},
): AuthorityBarrierSnapshot {
  const current = readAuthorityBarrier(db);
  if (current.state === "stable") return current;
  const pending = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM derived_invalidation_journal
      WHERE state IN ('pending', 'leased')`,
  ).get() as { count?: unknown } | undefined)?.count ?? 0);
  if (pending > 0 && options.projectionReady !== true) {
    return markAuthorityBarrierReconciling(
      db,
      "pending_derived_reconciliation",
      options.nowMs ?? Date.now(),
    );
  }
  return stabilizeAuthorityBarrier(
    db,
    readAuthorityVersionVector(db),
    options.nowMs ?? Date.now(),
    current.activeTransitionId ?? undefined,
  );
}

export function requireStableAuthorityBarrier(
  db: DatabaseSync,
  expected?: Pick<AuthorityBarrierSnapshot, "epoch" | "revision" | "vector">,
): AuthorityBarrierSnapshot {
  const current = readAuthorityBarrier(db);
  requireStableExpected(current, expected);
  return current;
}

export { hasAuthorityBarrier };

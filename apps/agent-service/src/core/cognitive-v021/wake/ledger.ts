import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getUnresolvedInFlightForWake } from "../effect/in-flight.js";
import {
  ARCHITECTURE_EPOCH,
  type CycleTriggerKind,
  type WakeRecord,
  type WakeState,
  type WakeTerminalReason,
} from "../types.js";
import { cycleIdFor, wakeIdFor } from "./identity.js";
import { getActiveDeferredFrontier } from "../frontier/ledger.js";

type WakeRow = Record<string, unknown>;

export type WakeAdmissionInput = {
  occurrenceId: string;
  triggerRef: string;
  sourceKind: WakeRecord["sourceKind"];
  conversationId: string;
  cycleId?: string;
  generation?: number;
  triggerKind?: CycleTriggerKind;
  occupantId?: string | null;
  authorityEpoch?: number;
  architectureEpoch?: string;
  preemptedGeneration?: number | null;
  capturedTriggerGeneration?: number | null;
  capturedAuthorityRevision: number;
  nowMs: number;
};

export type WakeAdmissionResult =
  | { kind: "created" | "existing"; wake: WakeRecord }
  | { kind: "stale" | "cancelled"; wake: WakeRecord; terminalWake: WakeRecord };

export type WakeRecoveryResult = {
  reclaimed: number;
  reconciling: number;
  quarantined: number;
};

function wakeError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceTriggerKind(sourceKind: WakeRecord["sourceKind"]): CycleTriggerKind {
  if (sourceKind === "future_trigger") return "future_trigger_due";
  if (sourceKind === "idle") return "idle_opportunity";
  if (sourceKind === "subscription") return "subscription_item";
  return "owner_message";
}

function toWake(row: WakeRow): WakeRecord {
  return {
    wakeId: text(row.wake_id),
    occurrenceId: text(row.occurrence_id),
    triggerRef: text(row.trigger_ref),
    sourceKind: row.source_kind as WakeRecord["sourceKind"],
    conversationId: text(row.conversation_id),
    cycleId: text(row.cycle_id),
    state: row.state as WakeState,
    terminalReason: (row.terminal_reason as WakeTerminalReason | null) ?? null,
    capturedTriggerGeneration: row.captured_trigger_generation == null
      ? null
      : number(row.captured_trigger_generation),
    capturedAuthorityRevision: number(row.captured_authority_revision),
    consequenceChainId: row.consequence_chain_id == null ? null : text(row.consequence_chain_id),
    leaseOwner: row.lease_owner == null ? null : text(row.lease_owner),
    leaseToken: row.lease_token == null ? null : text(row.lease_token),
    leaseExpiresAtMs: row.lease_expires_at_ms == null ? null : number(row.lease_expires_at_ms),
    cancellationId: row.cancellation_id == null ? null : text(row.cancellation_id),
  };
}

export function getWake(db: DatabaseSync, wakeId: string): WakeRecord | null {
  const row = db.prepare("SELECT * FROM wakes WHERE wake_id = ?").get(wakeId) as WakeRow | undefined;
  return row ? toWake(row) : null;
}

export function getWakeRequired(db: DatabaseSync, wakeId: string): WakeRecord {
  const wake = getWake(db, wakeId);
  if (!wake) throw wakeError("wake_missing");
  return wake;
}

export function getWakeForCycle(db: DatabaseSync, cycleId: string): WakeRecord | null {
  const row = db.prepare("SELECT * FROM wakes WHERE cycle_id = ?").get(cycleId) as WakeRow | undefined;
  return row ? toWake(row) : null;
}

function cycleIdFromWake(db: DatabaseSync, wakeId: string, requestedCycleId?: string): string {
  const row = db.prepare("SELECT cycle_id FROM wakes WHERE wake_id = ?").get(wakeId) as WakeRow | undefined;
  const existing = text(row?.cycle_id);
  if (requestedCycleId && existing && requestedCycleId !== existing) throw wakeError("wake_cycle_conflict");
  return requestedCycleId ?? existing ?? cycleIdFor(wakeId);
}

function ensureCycleInTransaction(db: DatabaseSync, input: WakeAdmissionInput, wakeId: string): void {
  const cycleId = cycleIdFromWake(db, wakeId, input.cycleId);
  const existing = db.prepare("SELECT cycle_id, wake_id, conversation_id FROM cycle_records WHERE cycle_id = ?").get(cycleId) as WakeRow | undefined;
  if (existing) {
    const existingWakeId = text(existing.wake_id);
    if (existingWakeId && existingWakeId !== wakeId) throw wakeError("wake_cycle_conflict");
    if (text(existing.conversation_id) !== input.conversationId) throw wakeError("wake_conversation_conflict");
    if (!existingWakeId) db.prepare("UPDATE cycle_records SET wake_id = ? WHERE cycle_id = ? AND wake_id IS NULL").run(wakeId, cycleId);
    return;
  }

  const activeFrontier = getActiveDeferredFrontier(db, input.conversationId);
  if (activeFrontier && activeFrontier.cycleId !== cycleId) {
    throw wakeError("conversation_occupied_by_frontier");
  }

  const maxRow = db.prepare("SELECT MAX(generation) AS generation FROM cycle_records WHERE conversation_id = ?").get(input.conversationId) as WakeRow | undefined;
  const generation = input.generation ?? number(maxRow?.generation) + 1;
  db.prepare(
    `INSERT INTO cycle_records
       (cycle_id, conversation_id, generation, wake_id, state, trigger_kind, trigger_ref,
        occupant_id, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms,
        compose_log_ids_json, preempted_generation)
     VALUES (?, ?, ?, ?, 'admitted', ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(
    cycleId,
    input.conversationId,
    generation,
    wakeId,
    input.triggerKind ?? sourceTriggerKind(input.sourceKind),
    input.triggerRef,
    input.occupantId ?? null,
    input.authorityEpoch ?? 1,
    input.architectureEpoch ?? ARCHITECTURE_EPOCH,
    input.nowMs,
    input.nowMs,
    input.preemptedGeneration ?? null,
  );
}

/** Internal form used by producer transactions that already hold BEGIN IMMEDIATE. */
export function admitWakeInTransaction(db: DatabaseSync, input: WakeAdmissionInput): WakeAdmissionResult {
  if (!input.occurrenceId.trim()) throw wakeError("occurrence_required");
  if (!input.triggerRef.trim()) throw wakeError("trigger_ref_required");
  if (!input.conversationId.trim()) throw wakeError("conversation_required");
  if (!Number.isInteger(input.capturedAuthorityRevision) || input.capturedAuthorityRevision < 0) throw wakeError("authority_revision_invalid");

  const existingRow = db.prepare("SELECT * FROM wakes WHERE occurrence_id = ?").get(input.occurrenceId) as WakeRow | undefined;
  if (existingRow) {
    const existing = toWake(existingRow);
    if (
      existing.triggerRef !== input.triggerRef
      || existing.sourceKind !== input.sourceKind
      || existing.conversationId !== input.conversationId
      || (input.cycleId != null && existing.cycleId !== input.cycleId)
    ) throw wakeError("occurrence_conflict");
    ensureCycleInTransaction(db, input, existing.wakeId);
    if (existing.state === "terminal" && existing.terminalReason === "cancelled") {
      const terminalWake = getWakeRequired(db, existing.wakeId);
      return { kind: "cancelled", wake: terminalWake, terminalWake };
    }
    if (existing.state === "terminal" && ["no_action", "expired", "quarantined", "superseded"].includes(existing.terminalReason ?? "")) {
      const terminalWake = getWakeRequired(db, existing.wakeId);
      return { kind: "stale", wake: terminalWake, terminalWake };
    }
    return { kind: "existing", wake: getWakeRequired(db, existing.wakeId) };
  }

  const wakeId = wakeIdFor(input.occurrenceId);
  const sameWake = db.prepare("SELECT occurrence_id FROM wakes WHERE wake_id = ?").get(wakeId) as WakeRow | undefined;
  if (sameWake && text(sameWake.occurrence_id) !== input.occurrenceId) throw wakeError("occurrence_conflict");
  const cycleId = input.cycleId ?? cycleIdFor(wakeId);
  const sameCycle = db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?").get(cycleId) as WakeRow | undefined;
  if (sameCycle && text(sameCycle.wake_id) && text(sameCycle.wake_id) !== wakeId) throw wakeError("wake_cycle_conflict");

  db.prepare(
    `INSERT INTO wakes
       (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
        state, terminal_reason, captured_trigger_generation, captured_authority_revision,
        created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?)`,
  ).run(
    wakeId,
    input.occurrenceId,
    input.triggerRef,
    input.sourceKind,
    input.conversationId,
    cycleId,
    input.capturedTriggerGeneration ?? null,
    input.capturedAuthorityRevision,
    input.nowMs,
    input.nowMs,
  );
  ensureCycleInTransaction(db, input, wakeId);
  return { kind: "created", wake: getWakeRequired(db, wakeId) };
}

export function admitWake(db: DatabaseSync, input: WakeAdmissionInput): WakeAdmissionResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = admitWakeInTransaction(db, input);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the admission error */ }
    throw error;
  }
}

export function claimWakeInTransaction(db: DatabaseSync, wakeId: string, workerId: string, nowMs: number, leaseMs: number): { leaseToken: string; wake: WakeRecord } {
  const current = getWakeRequired(db, wakeId);
  if (current.state === "terminal") throw wakeError("wake_terminal");
  if (current.state === "reconciling" || current.state === "consequence_pending") throw wakeError("wake_reconciliation_required");
  if (current.state === "authorized") {
    if (current.leaseExpiresAtMs == null || current.leaseExpiresAtMs > nowMs) throw wakeError("wake_not_claimable");
    if (hasAmbiguousEffect(db, wakeId)) throw wakeError("receipt_reconciliation_required");
    db.prepare("UPDATE wakes SET state = 'pending', lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ? WHERE wake_id = ? AND state = 'authorized'").run(nowMs, wakeId);
  }
  if (current.state === "claimed" && current.leaseExpiresAtMs != null && current.leaseExpiresAtMs > nowMs) throw wakeError("lease_held");

  const leaseToken = `wake-lease:${randomUUID()}`;
  const result = db.prepare(
    `UPDATE wakes
        SET state = 'claimed', lease_owner = ?, lease_token = ?, lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE wake_id = ? AND state IN ('pending', 'claimed')
        AND (state = 'pending' OR lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`,
  ).run(workerId, leaseToken, nowMs + leaseMs, nowMs, wakeId, nowMs);
  if (Number(result.changes) !== 1) throw wakeError("wake_claim_lost");
  return { leaseToken, wake: getWakeRequired(db, wakeId) };
}

export function renewWakeLeaseInTransaction(
  db: DatabaseSync,
  input: {
    wakeId: string;
    conversationId: string;
    cycleId: string;
    workerId: string;
    leaseToken: string;
    nowMs: number;
    leaseMs: number;
  },
): boolean {
  if (
    !input.wakeId.trim()
    || !input.conversationId.trim()
    || !input.cycleId.trim()
    || !input.workerId.trim()
    || !input.leaseToken.trim()
    || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
    || !Number.isSafeInteger(input.leaseMs)
    || input.leaseMs <= 0
  ) return false;
  const leaseMs = Math.min(15 * 60_000, Math.floor(input.leaseMs));
  const updated = db.prepare(
    `UPDATE wakes
        SET lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE wake_id = ? AND conversation_id = ? AND cycle_id = ?
        AND state = 'authorized' AND lease_owner = ? AND lease_token = ?
        AND cancellation_id IS NULL AND lease_expires_at_ms > ?`,
  ).run(
    input.nowMs + leaseMs,
    input.nowMs,
    input.wakeId,
    input.conversationId,
    input.cycleId,
    input.workerId,
    input.leaseToken,
    input.nowMs,
  );
  return Number(updated.changes) === 1;
}

export function claimWake(db: DatabaseSync, wakeId: string, workerId: string, nowMs: number, leaseMs: number): { leaseToken: string; wake: WakeRecord } {
  if (!workerId.trim()) throw wakeError("worker_required");
  const boundedLeaseMs = Math.max(1, Math.min(15 * 60_000, Math.floor(leaseMs)));
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = claimWakeInTransaction(db, wakeId, workerId, nowMs, boundedLeaseMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the claim error */ }
    throw error;
  }
}

export function authorizeWakeInTransaction(db: DatabaseSync, wakeId: string, leaseToken: string, nowMs: number): WakeRecord {
  const current = getWakeRequired(db, wakeId);
  if (current.state === "terminal") throw wakeError("wake_terminal");
  if (current.state !== "claimed" || current.leaseToken !== leaseToken) throw wakeError("lease_lost");
  if (current.leaseExpiresAtMs != null && current.leaseExpiresAtMs <= nowMs) throw wakeError("lease_expired");
  const result = db.prepare(
    `UPDATE wakes SET state = 'authorized', updated_at_ms = ?
      WHERE wake_id = ? AND state = 'claimed' AND lease_token = ?
        AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms > ?)`,
  ).run(nowMs, wakeId, leaseToken, nowMs);
  if (Number(result.changes) !== 1) throw wakeError("lease_lost");
  return getWakeRequired(db, wakeId);
}

export function authorizeWake(db: DatabaseSync, wakeId: string, leaseToken: string, nowMs: number): WakeRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = authorizeWakeInTransaction(db, wakeId, leaseToken, nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the authorization error */ }
    throw error;
  }
}

export function beginConsequenceInTransaction(db: DatabaseSync, wakeId: string, leaseToken: string, semanticPass: number, nowMs: number): { chainId: string; wake: WakeRecord } {
  if (!Number.isInteger(semanticPass) || semanticPass < 1) throw wakeError("semantic_pass_invalid");
  const current = getWakeRequired(db, wakeId);
  if (current.state === "terminal") throw wakeError("wake_terminal");
  if (current.state === "consequence_pending" && current.consequenceChainId) {
    return { chainId: current.consequenceChainId, wake: current };
  }
  if (current.state === "reconciling") throw wakeError("receipt_reconciliation_required");
  if (current.state !== "authorized" || current.leaseToken !== leaseToken) throw wakeError("lease_lost");
  if (current.leaseExpiresAtMs != null && current.leaseExpiresAtMs <= nowMs) throw wakeError("lease_expired");
  const chainId = `consequence:${randomUUID()}`;
  const result = db.prepare(
    `UPDATE wakes SET state = 'consequence_pending', consequence_chain_id = ?, updated_at_ms = ?
      WHERE wake_id = ? AND state = 'authorized' AND lease_token = ?`,
  ).run(chainId, nowMs, wakeId, leaseToken);
  if (Number(result.changes) !== 1) throw wakeError("consequence_exists");
  return { chainId, wake: getWakeRequired(db, wakeId) };
}

export function beginConsequence(db: DatabaseSync, wakeId: string, leaseToken: string, semanticPass: number, nowMs: number): { chainId: string; wake: WakeRecord } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = beginConsequenceInTransaction(db, wakeId, leaseToken, semanticPass, nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the consequence error */ }
    throw error;
  }
}

export function finishWakeInTransaction(db: DatabaseSync, wakeId: string, leaseToken: string | null, reason: WakeTerminalReason, nowMs: number): WakeRecord {
  const current = getWakeRequired(db, wakeId);
  if (current.state === "terminal") {
    if (current.terminalReason === reason) return current;
    throw wakeError("terminal_immutable");
  }
  if (current.state === "reconciling") throw wakeError("wake_reconciliation_required");
  if (current.state === "claimed" || current.state === "authorized" || current.state === "consequence_pending") {
    if (!leaseToken || current.leaseToken !== leaseToken) throw wakeError("lease_lost");
    if (current.leaseExpiresAtMs != null && current.leaseExpiresAtMs <= nowMs && reason === "completed") throw wakeError("lease_expired");
  } else if (current.state !== "pending") {
    throw wakeError("wake_finish_lost");
  }
  const result = db.prepare(
    `UPDATE wakes SET state = 'terminal', terminal_reason = ?, lease_token = NULL,
        lease_owner = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE wake_id = ? AND state != 'terminal'
        AND (lease_token = ? OR (state = 'pending' AND lease_token IS NULL))`,
  ).run(reason, nowMs, wakeId, leaseToken);
  if (Number(result.changes) !== 1) throw wakeError("wake_finish_lost");
  return getWakeRequired(db, wakeId);
}

export function finishWake(db: DatabaseSync, wakeId: string, leaseToken: string | null, reason: WakeTerminalReason, nowMs: number): WakeRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = finishWakeInTransaction(db, wakeId, leaseToken, reason, nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the terminalization error */ }
    throw error;
  }
}

export function recordWakeCancellationInTransaction(db: DatabaseSync, input: { wakeId: string; cancellationId?: string; nowMs: number }): WakeRecord {
  const cancellationId = input.cancellationId ?? `cancellation:${randomUUID()}`;
  const current = getWakeRequired(db, input.wakeId);
  if (current.state === "terminal") return current;
  db.prepare("UPDATE wakes SET cancellation_id = COALESCE(cancellation_id, ?), updated_at_ms = ? WHERE wake_id = ?").run(cancellationId, input.nowMs, input.wakeId);
  return getWakeRequired(db, input.wakeId);
}

/** Move a wake with an attributable in-flight consequence into reconciliation. */
export function reconcileWakeInTransaction(db: DatabaseSync, wakeId: string, nowMs: number): WakeRecord {
  const current = getWakeRequired(db, wakeId);
  if (current.state === "terminal" || current.state === "reconciling") return current;
  db.prepare(
    `UPDATE wakes
        SET state = 'reconciling', terminal_reason = NULL, lease_owner = NULL,
            lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE wake_id = ? AND state != 'terminal'`,
  ).run(nowMs, wakeId);
  return getWakeRequired(db, wakeId);
}

export function recordWakeCancellation(db: DatabaseSync, input: { wakeId: string; cancellationId?: string; nowMs: number }): WakeRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = recordWakeCancellationInTransaction(db, input);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the cancellation error */ }
    throw error;
  }
}

export function cancelWake(db: DatabaseSync, input: { wakeId: string; cancellationId?: string; nowMs: number }): WakeRecord {
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = recordWakeCancellationInTransaction(db, input);
    const result = current.state === "reconciling" || current.state === "consequence_pending"
      ? current
      : finishWakeInTransaction(db, input.wakeId, current.leaseToken, "cancelled", input.nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the cancellation error */ }
    throw error;
  }
}

function hasAmbiguousEffect(db: DatabaseSync, wakeId: string): boolean {
  return getUnresolvedInFlightForWake(db, wakeId) !== null;
}

/** Recover one safe lease or one ambiguous consequence at a time. */
export function recoverWakes(db: DatabaseSync, nowMs: number): WakeRecoveryResult {
  const ids = db.prepare("SELECT wake_id FROM wakes WHERE state != 'terminal' ORDER BY created_at_ms ASC, wake_id ASC").all() as WakeRow[];
  const result: WakeRecoveryResult = { reclaimed: 0, reconciling: 0, quarantined: 0 };
  for (const row of ids) {
    const wakeId = text(row.wake_id);
    if (!wakeId) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = getWake(db, wakeId);
      if (!current || current.state === "terminal") {
        db.exec("COMMIT");
        continue;
      }
      const cycle = db.prepare(
        "SELECT wake_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
      ).get(current.cycleId) as WakeRow | undefined;
      if (!cycle || text(cycle.wake_id) !== wakeId) {
        const changed = Number(db.prepare(
          `UPDATE wakes SET state = 'terminal', terminal_reason = 'quarantined',
              lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL,
              updated_at_ms = ?
             WHERE wake_id = ? AND state != 'terminal'`,
        ).run(nowMs, wakeId).changes);
        if (changed === 1) result.quarantined += 1;
        db.exec("COMMIT");
        continue;
      }
      if (current.state === "consequence_pending" || current.state === "reconciling") {
        if (hasAmbiguousEffect(db, wakeId) || current.state === "consequence_pending") {
          const changed = current.state === "reconciling" ? 0 : Number(db.prepare(
            `UPDATE wakes SET state = 'reconciling', updated_at_ms = ? WHERE wake_id = ? AND state = 'consequence_pending'`,
          ).run(nowMs, wakeId).changes);
          if (changed === 1) result.reconciling += 1;
        }
        db.exec("COMMIT");
        continue;
      }
      if ((current.state === "claimed" || current.state === "authorized") && current.leaseExpiresAtMs != null && current.leaseExpiresAtMs <= nowMs) {
        if (hasAmbiguousEffect(db, wakeId)) {
          const changed = Number(db.prepare(
            `UPDATE wakes SET state = 'reconciling', updated_at_ms = ? WHERE wake_id = ? AND state IN ('claimed', 'authorized')`,
          ).run(nowMs, wakeId).changes);
          if (changed === 1) result.reconciling += 1;
        } else {
          const changed = Number(db.prepare(
            `UPDATE wakes SET state = 'pending', lease_owner = NULL, lease_token = NULL,
                lease_expires_at_ms = NULL, updated_at_ms = ? WHERE wake_id = ? AND state IN ('claimed', 'authorized')`,
          ).run(nowMs, wakeId).changes);
          if (changed === 1) result.reclaimed += 1;
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the recovery error */ }
      throw error;
    }
  }
  return result;
}

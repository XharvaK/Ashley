import { appendInboxEventInTransaction, getInboxEvent } from "../cycle/inbox.js";
import { getConcern } from "../concerns/lineage.js";
import { listOccupancy } from "../concerns/occupancy.js";
import type { DatabaseSync } from "node:sqlite";
import type { FutureTrigger, InboxEvent, WakeRecord } from "../types.js";
import { occurrenceIdFor } from "../wake/identity.js";
import { admitWakeInTransaction, finishWakeInTransaction, getWake, recordWakeCancellationInTransaction } from "../wake/ledger.js";
import { getActiveDeferredFrontier } from "../frontier/ledger.js";

type Row = Record<string, unknown>;

export type ScheduleFutureTriggerInput = Omit<FutureTrigger, "status"> & {
  status?: FutureTrigger["status"];
};

export type FutureTriggerFireOptions = {
  conversationId?: string;
  nowMs?: number;
  onFire?: (input: { trigger: FutureTrigger; event: InboxEvent }) => Promise<{ thoughtModelAttempts?: number } | void> | { thoughtModelAttempts?: number } | void;
};

export type FutureTriggerFireResult = {
  fired: FutureTrigger[];
  suppressedStale: FutureTrigger[];
  events: InboxEvent[];
  thoughtModelAttempts: number;
};

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRow(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapTrigger(value: unknown): FutureTrigger | null {
  if (!isRow(value)) return null;
  const status = value.status;
  if (status !== "scheduled" && status !== "fired" && status !== "cancelled" && status !== "suppressed_stale") return null;
  if (typeof value.trigger_id !== "string" || typeof value.conversation_id !== "string" || typeof value.concern_id !== "string") return null;
  return {
    triggerId: value.trigger_id,
    conversationId: value.conversation_id,
    concernId: value.concern_id,
    snapshotHash: text(value.snapshot_hash),
    dueAtMs: number(value.due_at_ms),
    status,
    wakeId: value.wake_id == null ? null : text(value.wake_id),
    payload: parsePayload(value.payload_json),
  };
}

function referencePayload(value: unknown): Record<string, unknown> {
  if (!isRow(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLocaleLowerCase();
    if (normalizedKey.includes("statement") || normalizedKey.includes("essay") || normalizedKey.includes("prose") || normalizedKey === "text" || normalizedKey === "content") continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
    else if (Array.isArray(item)) result[key] = item.filter((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null);
    else if (isRow(item)) result[key] = referencePayload(item);
  }
  return result;
}

export const sanitizeFutureTriggerPayload = referencePayload;

function validateTrigger(input: ScheduleFutureTriggerInput): void {
  if (!input.triggerId.trim()) throw new Error("future_trigger_id_required");
  if (!input.conversationId.trim()) throw new Error("future_trigger_conversation_required");
  if (!input.concernId.trim()) throw new Error("future_trigger_concern_required");
  if (!input.snapshotHash.trim()) throw new Error("future_trigger_snapshot_required");
  if (!Number.isFinite(input.dueAtMs)) throw new Error("future_trigger_due_at_invalid");
}

export function scheduleFutureTrigger(db: DatabaseSync, input: ScheduleFutureTriggerInput): FutureTrigger {
  validateTrigger(input);
  const existing = getFutureTrigger(db, input.triggerId);
  if (existing && existing.status !== "scheduled") {
    if (
      existing.conversationId !== input.conversationId
      || existing.concernId !== input.concernId
      || existing.snapshotHash !== input.snapshotHash
      || existing.dueAtMs !== input.dueAtMs
    ) throw new Error("future_trigger_terminal");
    return existing;
  }
  db.prepare(
    `INSERT INTO future_triggers
       (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trigger_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       concern_id=excluded.concern_id, due_at_ms=excluded.due_at_ms,
       snapshot_hash=excluded.snapshot_hash, status=excluded.status,
        payload_json=excluded.payload_json`,
  ).run(
    input.triggerId,
    input.conversationId,
    input.concernId,
    input.dueAtMs,
    input.snapshotHash,
    input.status === "cancelled" ? "cancelled" : "scheduled",
    JSON.stringify(referencePayload(input.payload ?? {})),
  );
  const result = getFutureTrigger(db, input.triggerId);
  if (!result) throw new Error("future_trigger_schedule_lost");
  return result;
}

export function getFutureTrigger(db: DatabaseSync, triggerId: string): FutureTrigger | null {
  return mapTrigger(db.prepare("SELECT * FROM future_triggers WHERE trigger_id = ?").get(triggerId));
}

export function listFutureTriggers(db: DatabaseSync, conversationId?: string, options: { includeTerminal?: boolean; limit?: number } = {}): FutureTrigger[] {
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (conversationId) {
    clauses.push("conversation_id = ?");
    args.push(conversationId);
  }
  if (!options.includeTerminal) clauses.push("status IN ('scheduled', 'fired', 'suppressed_stale')");
  args.push(Math.max(1, Math.min(10_000, options.limit ?? 1000)));
  return db.prepare(
    `SELECT * FROM future_triggers ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY due_at_ms ASC, trigger_id ASC LIMIT ?`,
  ).all(...args)
    .map(mapTrigger)
    .filter((trigger): trigger is FutureTrigger => trigger !== null);
}

export function cancelFutureTrigger(db: DatabaseSync, triggerId: string): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const trigger = getFutureTrigger(db, triggerId);
    if (!trigger || trigger.status !== "scheduled") {
      db.exec("COMMIT");
      return false;
    }
    const result = db.prepare("UPDATE future_triggers SET status = 'cancelled' WHERE trigger_id = ? AND status = 'scheduled'").run(triggerId);
    if (number(result.changes) !== 1) throw new Error("future_trigger_cancel_lost");
    if (trigger.wakeId) {
      const wake = getWake(db, trigger.wakeId);
      if (wake && wake.state !== "terminal") {
        recordWakeCancellationInTransaction(db, { wakeId: trigger.wakeId, nowMs: Date.now() });
        if (wake.state !== "consequence_pending" && wake.state !== "reconciling") {
          try { finishWakeInTransaction(db, trigger.wakeId, wake.leaseToken, "cancelled", Date.now()); } catch { /* preserve reconciliation for an owned lease */ }
        }
      }
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}

function staleReason(db: DatabaseSync, trigger: FutureTrigger): string | null {
  const concern = getConcern(db, trigger.concernId);
  const occupancy = listOccupancy(db, trigger.conversationId).find((item) => item.concernId === trigger.concernId);
  if (!concern || !occupancy) return "missing_current_occupancy";
  if (concern.snapshotHash !== trigger.snapshotHash) return "snapshot_mismatch";
  if (concern.status === "resolved" || occupancy.status === "resolved") return "resolved_occupancy";
  if (concern.status === "dormant_but_revisitable" || occupancy.status === "dormant_but_revisitable") return "dormant_occupancy";
  if (concern.status === "quarantined" || occupancy.status === "quarantined") return "quarantined_occupancy";
  if (occupancy.status !== "active" && occupancy.status !== "investigating" && occupancy.status !== "waiting_for_evidence") return "non_grounded_occupancy";
  return null;
}

function recordStale(db: DatabaseSync, trigger: FutureTrigger, reason: string, nowMs: number): void {
  const occupancy = listOccupancy(db, trigger.conversationId).find((item) => item.concernId === trigger.concernId);
  db.prepare("UPDATE future_triggers SET status = 'suppressed_stale' WHERE trigger_id = ? AND status = 'scheduled'").run(trigger.triggerId);
  db.prepare(
    `INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable)
     VALUES (?, ?, ?, 0)`,
  ).run(
    `future-trigger:${trigger.triggerId}`,
    occupancy?.updatedGeneration ?? 0,
    JSON.stringify({ triggerKind: "future_trigger_due", triggerId: trigger.triggerId, concernId: trigger.concernId, result: "suppressed_stale", reason, atMs: nowMs }),
  );
}

export async function fireDueTriggers(
  db: DatabaseSync,
  options: FutureTriggerFireOptions = {},
): Promise<FutureTriggerFireResult> {
  const nowMs = options.nowMs ?? Date.now();
  const clauses = ["status = 'scheduled'", "due_at_ms <= ?"];
  const args: Array<string | number> = [nowMs];
  if (options.conversationId) {
    clauses.push("conversation_id = ?");
    args.push(options.conversationId);
  }
  const candidates = db.prepare(`SELECT * FROM future_triggers WHERE ${clauses.join(" AND ")} ORDER BY due_at_ms ASC, trigger_id ASC`).all(...args)
    .map(mapTrigger)
    .filter((trigger): trigger is FutureTrigger => trigger !== null);
  const fired: FutureTrigger[] = [];
  const suppressedStale: FutureTrigger[] = [];
  const events: InboxEvent[] = [];

  for (const candidate of candidates) {
    const result = matureFutureTriggerToWake(db, candidate.triggerId, { nowMs });
    if (!result) continue;
    if (result.kind === "stale") {
      const trigger = getFutureTrigger(db, candidate.triggerId);
      if (trigger) suppressedStale.push(trigger);
    } else if (result.wake && result.event) {
      const trigger = getFutureTrigger(db, candidate.triggerId);
      if (trigger) fired.push(trigger);
      events.push(result.event);
    }
  }

  let thoughtModelAttempts = 0;
  if (options.onFire) {
    for (let index = 0; index < fired.length; index += 1) {
      const result = await options.onFire({ trigger: fired[index]!, event: events[index]! });
      thoughtModelAttempts += number(result && "thoughtModelAttempts" in result ? result.thoughtModelAttempts : 0);
    }
  }
  return { fired, suppressedStale, events, thoughtModelAttempts };
}

export type FutureTriggerMaturityResult = {
  kind: "created" | "existing" | "stale" | "cancelled";
  wake: WakeRecord;
  event: InboxEvent | null;
};

/** Claim, validate, and bind one due trigger in one sidecar transaction. */
export function matureFutureTriggerToWake(
  db: DatabaseSync,
  triggerId: string,
  options: { nowMs?: number; capturedAuthorityRevision?: number } = {},
): FutureTriggerMaturityResult | null {
  const nowMs = options.nowMs ?? Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = getFutureTrigger(db, triggerId);
    if (!current || current.status === "cancelled" || (current.status === "scheduled" && current.dueAtMs > nowMs)) {
      db.exec("COMMIT");
      return null;
    }
    const activeFrontier = getActiveDeferredFrontier(db, current.conversationId);
    if (activeFrontier) {
      db.exec("COMMIT");
      return null;
    }
    const occurrenceId = occurrenceIdFor({ sourceKind: "future_trigger", triggerRef: current.triggerId, conversationId: current.conversationId });
    const admission = admitWakeInTransaction(db, {
      occurrenceId,
      triggerRef: current.triggerId,
      sourceKind: "future_trigger",
      conversationId: current.conversationId,
      triggerKind: "future_trigger_due",
      capturedTriggerGeneration: listOccupancy(db, current.conversationId).find((item) => item.concernId === current.concernId)?.updatedGeneration ?? null,
      capturedAuthorityRevision: options.capturedAuthorityRevision ?? 0,
      nowMs,
    });
    if (admission.kind === "cancelled" || admission.kind === "stale") {
      db.exec("COMMIT");
      return { kind: admission.kind, wake: admission.terminalWake, event: null };
    }
    const wake = admission.wake;
    const existingEvent = getInboxEvent(db, `future-trigger:${current.triggerId}`);
    if (current.status === "fired" && current.wakeId && existingEvent) {
      db.exec("COMMIT");
      return { kind: "existing", wake, event: existingEvent };
    }
    const reason = current.status === "scheduled" ? staleReason(db, current) : null;
    if (reason) {
      db.prepare("UPDATE future_triggers SET status = 'suppressed_stale', wake_id = ? WHERE trigger_id = ? AND status = 'scheduled'").run(wake.wakeId, current.triggerId);
      recordStale(db, current, reason, nowMs);
      if (wake.state !== "terminal") finishWakeInTransaction(db, wake.wakeId, null, "no_action", nowMs);
      const terminal = getWake(db, wake.wakeId);
      if (!terminal) throw new Error("wake_missing");
      db.exec("COMMIT");
      return { kind: "stale", wake: terminal, event: null };
    }
    db.prepare(
      "UPDATE future_triggers SET status = 'fired', wake_id = ? WHERE trigger_id = ? AND status IN ('scheduled', 'fired')",
    ).run(wake.wakeId, current.triggerId);
    const event = existingEvent ?? appendInboxEventInTransaction(db, {
      id: `future-trigger:${current.triggerId}`,
      wakeId: wake.wakeId,
      conversationId: current.conversationId,
      kind: "future_trigger_due",
      payload: { triggerId: current.triggerId, concernId: current.concernId, snapshotHash: current.snapshotHash },
      createdAtMs: nowMs,
    }, `future-trigger:${current.triggerId}`);
    db.exec("COMMIT");
    return { kind: admission.kind === "created" ? "created" : "existing", wake, event };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}

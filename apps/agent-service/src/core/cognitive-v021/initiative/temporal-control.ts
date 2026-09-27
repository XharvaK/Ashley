import type { DatabaseSync } from "node:sqlite";
import {
  cancelFutureTriggerWithOutcome,
  getFutureTrigger,
  listFutureTriggers,
} from "./future-triggers.js";
import {
  cancelObservationSubscription,
  createObservationSubscription,
  listObservationSubscriptions,
} from "../observation/subscriptions.js";
import { DEFAULT_MAX_SUBSCRIPTIONS, type FutureTrigger, type ObservationSubscription } from "../types.js";
import { relinquishCommitment } from "../../relationship/commitment-admission.js";
import { parseStoredWorkingContextInterpretationEnvelope } from "../evidence/interpretation-envelope.js";

type Row = Record<string, unknown>;

export type TemporalKind = "future_trigger" | "subscription" | "commitment" | "directive";
export type TemporalOperation = "list" | "inspect" | "cancel" | "amend" | "withdraw";

export type TemporalControlInput = {
  operation: TemporalOperation;
  kind?: TemporalKind;
  id?: string;
  limit?: number;
  dueAtMs?: number;
  purpose?: string | null;
  hasDueAtMs?: boolean;
  hasPurpose?: boolean;
  nowMs?: number;
};

type TemporalRecord = {
  kind: TemporalKind;
  id: string;
  conversationId: string | null;
  purpose: string | null;
  dueAtMs: number | null;
  concernId: string | null;
  status: string;
  cancellationState: "not_cancelled" | "cancelled" | "completed" | "withdrawn" | "not_applicable";
  [key: string]: unknown;
};

type TemporalResult = {
  operation: TemporalOperation;
  kind?: TemporalKind;
  id?: string;
  records?: Record<string, unknown>;
  record?: TemporalRecord;
  acknowledgement?: string;
  status?: string;
  cancellationState?: string;
  wakeState?: string | null;
  activeWorkAborted?: boolean;
  sourceReadable?: boolean;
  changed?: boolean;
};

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function record(value: unknown): Row | null {
  return isRow(value) ? value : null;
}

function commitmentPurpose(row: Row): string {
  const evidence = record(parseJson(row.evidence_json));
  const proposal = record(evidence?.proposal);
  return text(proposal?.action) || text(row.text);
}

function commitmentDueAtMs(row: Row): number | null {
  const fireAtMs = nullableNumber(row.fire_at_ms);
  if (fireAtMs !== null) return fireAtMs;
  const dueAt = text(row.due_at);
  if (!dueAt) return null;
  const parsed = Date.parse(dueAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function commitmentCancellationState(row: Row): TemporalRecord["cancellationState"] {
  const state = text(row.commitment_state);
  const status = text(row.status);
  if (state === "completed" || status === "fulfilled") return "completed";
  if (state === "relinquished" || state === "revised" || state === "missed_overdue" || status === "released") return "cancelled";
  return "not_cancelled";
}

function projectFutureTrigger(trigger: FutureTrigger): TemporalRecord {
  const purpose = typeof trigger.payload?.purpose === "string" && trigger.payload.purpose.trim()
    ? trigger.payload.purpose
    : null;
  return {
    kind: "future_trigger",
    id: trigger.triggerId,
    conversationId: trigger.conversationId,
    purpose,
    dueAtMs: trigger.dueAtMs,
    concernId: trigger.concernId,
    status: trigger.status,
    cancellationState: trigger.status === "cancelled" ? "cancelled" : "not_cancelled",
    wakeId: trigger.wakeId ?? null,
    snapshotHash: trigger.snapshotHash,
    evidenceRefs: [...(trigger.evidenceRefs ?? [])],
    timingPolicyId: trigger.timingPolicyId ?? null,
  };
}

function projectSubscription(subscription: ObservationSubscription): TemporalRecord {
  return {
    kind: "subscription",
    id: subscription.subscriptionId,
    conversationId: subscription.conversationId,
    purpose: subscription.scope || subscription.source || null,
    dueAtMs: subscription.expiresAtMs,
    concernId: subscription.concernId,
    status: subscription.status,
    cancellationState: subscription.status === "cancelled" ? "cancelled" : "not_cancelled",
    source: subscription.source,
    scope: subscription.scope,
    topicKeys: [...subscription.topicKeys],
    match: subscription.match,
    externalSource: subscription.externalSource ?? null,
  };
}

function projectCommitment(row: Row): TemporalRecord {
  const state = text(row.commitment_state) || text(row.status) || "unknown";
  return {
    kind: "commitment",
    id: text(row.entity_uuid),
    conversationId: null,
    purpose: commitmentPurpose(row) || null,
    dueAtMs: commitmentDueAtMs(row),
    concernId: null,
    status: state,
    cancellationState: commitmentCancellationState(row),
    legacyStatus: text(row.status),
    commitmentState: text(row.commitment_state),
    leaseExpiresAtMs: nullableNumber(row.lease_expires_at_ms),
    attemptCount: nullableNumber(row.attempt_count) ?? 0,
  };
}

function directiveFromRow(row: Row): TemporalRecord | null {
  const payload = record(parseJson(row.payload_json));
  const envelopeValue = payload?.interpretationEnvelope;
  const envelopeRow = record(envelopeValue);
  const lifecycle = row.applicability_lifecycle ?? envelopeRow?.applicabilityLifecycle;
  const envelope = parseStoredWorkingContextInterpretationEnvelope(envelopeValue, lifecycle);
  if (!envelope || envelope.kind !== "directive_interpretation" || typeof row.id !== "string") return null;
  const support = envelope.support.map((ref) => ({ ...ref }));
  return {
    kind: "directive",
    id: row.id,
    conversationId: text(row.conversation_id) || null,
    purpose: typeof payload?.text === "string" ? payload.text : null,
    dueAtMs: null,
    concernId: envelope.applicability.concernId ?? null,
    status: text(payload?.status) || "active",
    cancellationState: envelope.applicabilityLifecycle === "withdrawn" ? "withdrawn" : "not_cancelled",
    applicabilityLifecycle: envelope.applicabilityLifecycle,
    sourceReadable: true,
    support,
    superseded: Number(row.superseded ?? 0) === 1,
  };
}

function listCommitments(nuclearDb: DatabaseSync, ownerId: string, limit: number): TemporalRecord[] {
  const rows = nuclearDb.prepare(
    `SELECT * FROM ashley_self_commitments
      WHERE owner_id = ?
        AND (status IN ('active', 'motivated')
             OR commitment_state IN ('admitted', 'communicated', 'attempted', 'deferred_blocked'))
      ORDER BY COALESCE(fire_at_ms, 0), entity_uuid
      LIMIT ?`,
  ).all(ownerId, limit) as Row[];
  return rows.map(projectCommitment).filter((item) => item.id.length > 0);
}

function listDirectives(sidecar: DatabaseSync, limit: number): TemporalRecord[] {
  const rows = sidecar.prepare(
    `SELECT id, conversation_id, payload_json, superseded, applicability_lifecycle
       FROM working_context_items
      WHERE superseded = 0
      ORDER BY COALESCE(updated_generation, 0) DESC, id ASC
      LIMIT ?`,
  ).all(limit) as Row[];
  return rows.map(directiveFromRow).filter((item): item is TemporalRecord => item !== null);
}

function getDirective(sidecar: DatabaseSync, id: string): TemporalRecord | null {
  const row = sidecar.prepare(
    `SELECT id, conversation_id, payload_json, superseded, applicability_lifecycle
       FROM working_context_items WHERE id = ? LIMIT 1`,
  ).get(id) as Row | undefined;
  return row ? directiveFromRow(row) : null;
}

function getCommitmentRow(nuclearDb: DatabaseSync, ownerId: string, id: string): Row | null {
  const row = nuclearDb.prepare(
    "SELECT * FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ? LIMIT 1",
  ).get(ownerId, id) as Row | undefined;
  return row ?? null;
}

function getSubscription(sidecar: DatabaseSync, id: string): ObservationSubscription | null {
  return listObservationSubscriptions(sidecar, undefined, { includeCancelled: true, limit: 10_000 })
    .find((item) => item.subscriptionId === id) ?? null;
}

function getRecord(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  ownerId: string,
  kind: TemporalKind,
  id: string,
): TemporalRecord | null {
  if (kind === "future_trigger") {
    const trigger = getFutureTrigger(sidecar, id);
    return trigger ? projectFutureTrigger(trigger) : null;
  }
  if (kind === "subscription") {
    const subscription = getSubscription(sidecar, id);
    return subscription ? projectSubscription(subscription) : null;
  }
  if (kind === "commitment") {
    const row = getCommitmentRow(nuclearDb, ownerId, id);
    return row ? projectCommitment(row) : null;
  }
  return getDirective(sidecar, id);
}

function amendFutureTrigger(
  sidecar: DatabaseSync,
  id: string,
  input: TemporalControlInput,
): TemporalResult | null {
  const current = getFutureTrigger(sidecar, id);
  if (!current) return null;
  if (current.status !== "scheduled" && current.status !== "needs_review") {
    return { operation: "amend", kind: "future_trigger", id, status: current.status, changed: false, acknowledgement: "not_amendable" };
  }
  const nextDueAtMs = input.hasDueAtMs ? input.dueAtMs : current.dueAtMs;
  if (nextDueAtMs === undefined || !Number.isSafeInteger(nextDueAtMs) || nextDueAtMs < 0) {
    return { operation: "amend", kind: "future_trigger", id, status: current.status, changed: false, acknowledgement: "invalid_due_time" };
  }
  const payload = { ...(current.payload ?? {}) };
  if (input.hasPurpose) {
    if (input.purpose === null) delete payload.purpose;
    else payload.purpose = input.purpose;
  }
  const nextPayload = JSON.stringify(payload);
  const changed = current.dueAtMs !== nextDueAtMs
    || JSON.stringify(current.payload ?? {}) !== nextPayload;
  if (changed) {
    sidecar.prepare(
      `UPDATE future_triggers SET due_at_ms = ?, payload_json = ?
         WHERE trigger_id = ? AND status IN ('scheduled', 'needs_review')`,
    ).run(nextDueAtMs, nextPayload, id);
  }
  const next = getFutureTrigger(sidecar, id);
  return {
    operation: "amend",
    kind: "future_trigger",
    id,
    status: next?.status ?? current.status,
    changed,
    acknowledgement: changed ? "amended" : "unchanged",
    record: next ? projectFutureTrigger(next) : undefined,
  };
}

function amendSubscription(
  sidecar: DatabaseSync,
  id: string,
  input: TemporalControlInput,
): TemporalResult | null {
  const current = getSubscription(sidecar, id);
  if (!current) return null;
  if (!input.hasDueAtMs || input.dueAtMs === undefined || !Number.isSafeInteger(input.dueAtMs) || input.dueAtMs <= 0 || input.hasPurpose) {
    return { operation: "amend", kind: "subscription", id, status: current.status, changed: false, acknowledgement: "unsupported_fields" };
  }
  const next = createObservationSubscription(sidecar, {
    ...current,
    expiresAtMs: input.dueAtMs,
    status: current.status,
  }, DEFAULT_MAX_SUBSCRIPTIONS, { authority: "owner_request" });
  return {
    operation: "amend",
    kind: "subscription",
    id,
    status: next.status,
    changed: next.expiresAtMs !== current.expiresAtMs,
    acknowledgement: next.expiresAtMs !== current.expiresAtMs ? "amended" : "unchanged",
    record: projectSubscription(next),
  };
}

function latestDeliveryFact(nuclearDb: DatabaseSync, ownerId: string, commitmentId: string): { state: string; plannedCount: number; receiptCount: number } | null {
  const row = nuclearDb.prepare(
    `SELECT r.state AS state,
            COUNT(b.id) AS planned_count,
            COUNT(b.discord_message_id) AS receipt_count
       FROM delivery_reservations r
       LEFT JOIN delivery_bubbles b ON b.reservation_id = r.id
      WHERE r.owner_id = ? AND r.commitment_id = ?
        AND r.state IN ('reserved', 'sending', 'committed', 'partially_delivered')
      GROUP BY r.id
      ORDER BY r.id DESC LIMIT 1`,
  ).get(ownerId, commitmentId) as Row | undefined;
  if (!row) return null;
  return {
    state: text(row.state),
    plannedCount: Number(row.planned_count ?? 0),
    receiptCount: Number(row.receipt_count ?? 0),
  };
}

function cancelCommitment(
  nuclearDb: DatabaseSync,
  ownerId: string,
  id: string,
  nowMs: number,
): TemporalResult | null {
  const row = getCommitmentRow(nuclearDb, ownerId, id);
  if (!row) return null;
  const current = projectCommitment(row);
  if (current.cancellationState === "completed") {
    return { operation: "cancel", kind: "commitment", id, status: current.status, cancellationState: "completed", acknowledgement: "effect_already_completed", changed: false };
  }
  if (current.cancellationState === "cancelled") {
    return { operation: "cancel", kind: "commitment", id, status: current.status, cancellationState: "cancelled", acknowledgement: "already_cancelled", changed: false };
  }
  const delivery = latestDeliveryFact(nuclearDb, ownerId, id);
  const completedDelivery = delivery && delivery.plannedCount > 0
    && delivery.receiptCount >= delivery.plannedCount
    && (delivery.state === "committed" || delivery.state === "partially_delivered");
  if (completedDelivery) {
    return { operation: "cancel", kind: "commitment", id, status: current.status, cancellationState: "completed", acknowledgement: "effect_already_completed", changed: false };
  }
  const changed = relinquishCommitment(nuclearDb, {
    ownerId,
    commitmentId: id,
    reason: "owner_temporal_cancel",
    nowMs,
  });
  if (!changed) {
    const next = getCommitmentRow(nuclearDb, ownerId, id);
    const projected = next ? projectCommitment(next) : current;
    return {
      operation: "cancel",
      kind: "commitment",
      id,
      status: projected.status,
      cancellationState: projected.cancellationState,
      acknowledgement: projected.cancellationState === "completed" ? "effect_already_completed" : "already_cancelled",
      changed: false,
    };
  }
  const uncertainDelivery = delivery && (delivery.state === "reserved" || delivery.state === "sending" || delivery.state === "partially_delivered");
  return {
    operation: "cancel",
    kind: "commitment",
    id,
    status: "relinquished",
    cancellationState: "cancelled",
    acknowledgement: uncertainDelivery ? "effect_unknown" : "cancelled",
    changed: true,
  };
}

function withdrawDirective(sidecar: DatabaseSync, id: string): TemporalResult | null {
  const row = sidecar.prepare(
    `SELECT id, conversation_id, payload_json, superseded, applicability_lifecycle
       FROM working_context_items WHERE id = ? LIMIT 1`,
  ).get(id) as Row | undefined;
  if (!row) return null;
  const current = directiveFromRow(row);
  if (!current) return { operation: "withdraw", kind: "directive", id, changed: false, acknowledgement: "not_a_directive" };
  if (current.cancellationState === "withdrawn") {
    return { operation: "withdraw", kind: "directive", id, changed: false, acknowledgement: "already_withdrawn", sourceReadable: true, record: current };
  }
  const payload = record(parseJson(row.payload_json));
  const envelope = record(payload?.interpretationEnvelope);
  if (!payload || !envelope) return { operation: "withdraw", kind: "directive", id, changed: false, acknowledgement: "not_a_directive" };
  const nextPayload = {
    ...payload,
    interpretationEnvelope: { ...envelope, applicabilityLifecycle: "withdrawn" },
  };
  sidecar.prepare(
    `UPDATE working_context_items
        SET payload_json = ?, applicability_lifecycle = 'withdrawn'
      WHERE id = ?`,
  ).run(JSON.stringify(nextPayload), id);
  const next = getDirective(sidecar, id);
  return {
    operation: "withdraw",
    kind: "directive",
    id,
    changed: true,
    acknowledgement: "withdrawn",
    sourceReadable: true,
    record: next ?? current,
  };
}

export function executeTemporalControl(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  ownerId: string,
  input: TemporalControlInput,
): TemporalResult | null {
  const limit = Math.max(1, Math.min(100, input.limit ?? 100));
  if (input.operation === "list") {
    return {
      operation: "list",
      records: {
        futureTriggers: listFutureTriggers(sidecar, undefined, { includeTerminal: true, limit }).map(projectFutureTrigger),
        subscriptions: listObservationSubscriptions(sidecar, undefined, { includeCancelled: true, limit }).map(projectSubscription),
        commitments: listCommitments(nuclearDb, ownerId, limit),
        directives: listDirectives(sidecar, limit),
      },
    };
  }
  if (!input.kind || !input.id) return null;
  if (input.operation === "inspect") {
    const found = getRecord(sidecar, nuclearDb, ownerId, input.kind, input.id);
    return found ? { operation: "inspect", kind: input.kind, id: input.id, record: found } : null;
  }
  if (input.operation === "cancel") {
    if (input.kind === "future_trigger") {
      const result = cancelFutureTriggerWithOutcome(sidecar, input.id, input.nowMs ?? Date.now());
      if (!result.trigger && result.acknowledgement === "not_found") return null;
      return {
        operation: "cancel",
        kind: input.kind,
        id: input.id,
        acknowledgement: result.acknowledgement,
        status: result.trigger?.status,
        wakeState: result.wake?.state ?? null,
        activeWorkAborted: result.activeWorkAborted,
        changed: result.acknowledgement === "queued_cancelled"
          || result.acknowledgement === "effect_fenced"
          || result.acknowledgement === "effect_unknown",
      };
    }
    if (input.kind === "subscription") {
      const current = getSubscription(sidecar, input.id);
      if (!current) return null;
      const changed = current.status === "active" ? cancelObservationSubscription(sidecar, input.id) : false;
      return {
        operation: "cancel",
        kind: input.kind,
        id: input.id,
        acknowledgement: changed ? "queued_cancelled" : "already_cancelled",
        status: "cancelled",
        cancellationState: "cancelled",
        changed,
      };
    }
    if (input.kind === "commitment") return cancelCommitment(nuclearDb, ownerId, input.id, input.nowMs ?? Date.now());
    return { operation: "cancel", kind: input.kind, id: input.id, acknowledgement: "unsupported" , changed: false };
  }
  if (input.operation === "amend") {
    if (input.kind === "future_trigger") return amendFutureTrigger(sidecar, input.id, input);
    if (input.kind === "subscription") return amendSubscription(sidecar, input.id, input);
    return { operation: "amend", kind: input.kind, id: input.id, acknowledgement: "unsupported_fields", changed: false };
  }
  if (input.kind !== "directive") return { operation: "withdraw", kind: input.kind, id: input.id, acknowledgement: "unsupported", changed: false };
  return withdrawDirective(sidecar, input.id);
}

export type { TemporalRecord, TemporalResult };

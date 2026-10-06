// 8d: a stored Domus observation becomes one private Domus pass. The thalamus selects, the embodiment
// budget pays, the inbox carries it, and Thought reads a portrait rebuilt from the durable rows.
import type { DatabaseSync } from "node:sqlite";
import { appendInboxEventInTransaction, getCycle, getInboxEvent } from "../cognitive-v021/cycle/inbox.js";
import { configureBudgetPolicy, resolveBudgetPolicy, PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS } from "../cognitive-v021/private-budget/policies.js";
import { getPrivateBudgetProjection, getPrivateReservationForWake, reservePrivateThought } from "../cognitive-v021/private-budget/ledger.js";
import type { DomusPending } from "../cognitive-v021/thalamus/nuclei/domus.js";
import { domusActBinding, domusOptionsFor, recentDomusActs, type DomusActBinding, type DomusOptionObject, type DomusRecentAct } from "./acts.js";
import { compareDomusReads, domusActNewsSince, domusReadOf, previousDomusRead, type DomusChanges } from "./changes.js";

export const EMBODIMENT_POLICY_ID = "ashley.embodiment.v1";
export const EMBODIMENT_WINDOW_MS = 60 * 60 * 1000;
/** Three helper heartbeats (one a minute): after that the attachment is no longer armed. */
export const DOMUS_ARMED_MS = 180_000;
export const DOMUS_PENDING_LIMIT = 32;
/** The events since the last pass, within this many bytes; newest kept. */
export const DOMUS_EVENTS_BYTES = 4096;

/** M5: how long after the game's last word a conversation still carries her body's state. */
export const DOMUS_NOW_WINDOW_MS = 12 * 60 * 60 * 1000;
/** M5: the compact now, within this many bytes (the least essential parts go first). */
export const DOMUS_NOW_BYTES = 2048;

/** M5 (live 2026-10-06: told on Discord to get off the PC and asked about her job, she knew
 * nothing of her Sim): her body in the game as last seen, for turns outside a Domus pass. */
export type DomusNow = { world: string; asOfMs: number; live: boolean; body: Record<string, unknown> };

export type DomusEvent = { observationId: string; atMs: number; kind: string; facts: Record<string, unknown> };
export type DomusForThought = {
  world: string;
  asOfMs: number;
  observationIds: string[];
  /** H0.4: what changed since the pass she last settled in this game session (Host facts). */
  changes: DomusChanges;
  portrait?: Record<string, unknown>;
  events: DomusEvent[];
  omittedEvents?: number;
  /** 8f: what she may choose to do now (refs to name in domusAct), when acting is on. */
  options?: DomusOptionObject[];
  /** 8f: her own recent acts in this world and the latest thing known about each. */
  acts?: DomusRecentAct[];
};

type Row = Record<string, unknown>;
type Percept = { kind: string; salience: number; facts: Record<string, unknown> };

/** Host/Owner supplied (E3-B1); this function supplies no limit and activates nothing. */
export function configureEmbodimentBudget(db: DatabaseSync, input: { limit: number; version: number }) {
  return configureBudgetPolicy(db, { policyId: EMBODIMENT_POLICY_ID, version: input.version, limit: input.limit,
    windowMs: EMBODIMENT_WINDOW_MS, clockDiscontinuityMs: PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS });
}

export function embodimentBudgetAvailable(db: DatabaseSync, nowMs: number): boolean {
  try {
    if (resolveBudgetPolicy(db, EMBODIMENT_POLICY_ID).windowMs !== EMBODIMENT_WINDOW_MS) return false;
    const budget = getPrivateBudgetProjection(db, { policyId: EMBODIMENT_POLICY_ID, wallClockNowMs: nowMs });
    return budget.remaining > 0 && budget.clockState !== "clock_reconciliation";
  } catch { return false; }
}

/** Helper sessions whose latest heartbeat said attached and is recent. */
export function armedAttachments(db: DatabaseSync, nowMs: number): Set<string> {
  const armed = new Set<string>();
  const rows = db.prepare("SELECT helper_session, last_received_at_ms, last_json FROM domus_heartbeats WHERE last_received_at_ms >= ? AND last_received_at_ms <= ?")
    .all(nowMs - DOMUS_ARMED_MS, nowMs) as Row[];
  for (const row of rows) {
    try {
      if ((JSON.parse(String(row.last_json)) as { attached?: unknown }).attached === true) armed.add(String(row.helper_session));
    } catch { /* an unreadable heartbeat arms nothing */ }
  }
  return armed;
}

function percepts(payloadJson: unknown): Percept[] {
  try {
    const payload = JSON.parse(String(payloadJson)) as { percepts?: unknown };
    return Array.isArray(payload.percepts) ? payload.percepts as Percept[] : [];
  } catch { return []; }
}

function pendingRows(db: DatabaseSync, attachment: string, nowMs: number, throughReceiptMs = nowMs): Row[] {
  return (db.prepare(`SELECT observation_id, receipt_time_ms, seq, payload_json FROM domus_observations
    WHERE attachment = ? AND admission_state = 'stored' AND undone_at_ms IS NULL AND expires_at_ms > ? AND receipt_time_ms <= ?
    ORDER BY receipt_time_ms DESC, seq DESC, observation_id DESC LIMIT ?`)
    .all(attachment, nowMs, Math.min(nowMs, throughReceiptMs), DOMUS_PENDING_LIMIT) as Row[]).reverse();
}

/** Read-only nucleus facts: one entry per armed attachment with pending observations, oldest first. */
export function pendingDomus(db: DatabaseSync, nowMs: number): DomusPending[] {
  const result: DomusPending[] = [];
  for (const attachment of [...armedAttachments(db, nowMs)].sort()) {
    const observations = pendingRows(db, attachment, nowMs).map(row => {
      const items = percepts(row.payload_json);
      return {
        observationId: String(row.observation_id),
        receiptTimeMs: Number(row.receipt_time_ms),
        salience: Math.max(0, ...items.map(item => Number.isFinite(item.salience) ? item.salience : 0)),
        alwaysThrough: items.some(item => item.facts?.urgency === "always_through"),
      };
    });
    if (observations.length) result.push({ attachment, observations });
  }
  return result;
}

/** The selected cycle and timing receipt commit together with the rows' admission; disarmed or unpaid work is deferred. */
export function selectDomusNotification(db: DatabaseSync, input: {
  observationId: string; conversationId: string; ownerId: string; authorityEpoch: number; nowMs: number; bind: (cycleId: string) => void;
}) {
  const id = "domus-notification:" + input.observationId;
  const existing = getInboxEvent(db, id);
  if (existing) return { kind: "existing" as const, event: existing };
  const newest = db.prepare("SELECT attachment, world, receipt_time_ms FROM domus_observations WHERE observation_id = ?").get(input.observationId) as Row | undefined;
  if (!newest) throw new Error("domus_observation_missing");
  const attachment = String(newest.attachment);
  if (!armedAttachments(db, input.nowMs).has(attachment)) return { kind: "disarmed" as const };
  if (!embodimentBudgetAvailable(db, input.nowMs)) return { kind: "deferred" as const };
  db.exec("BEGIN IMMEDIATE");
  let event: ReturnType<typeof appendInboxEventInTransaction>;
  try {
    const included = pendingRows(db, attachment, input.nowMs, Number(newest.receipt_time_ms));
    if (!included.some(row => row.observation_id === input.observationId)) throw new Error("domus_observation_not_pending");
    const observationIds = included.map(row => String(row.observation_id));
    event = appendInboxEventInTransaction(db, { id, conversationId: input.conversationId, kind: "domus_notification",
      payload: { domus: { world: String(newest.world), attachment, observationIds }, occupantId: input.ownerId, authorityEpoch: input.authorityEpoch },
      createdAtMs: input.nowMs }, id);
    db.prepare("UPDATE inbox_events SET next_eligible_at_ms=? WHERE id=? AND state='pending'").run(Number.MAX_SAFE_INTEGER, id);
    input.bind(String((event.payload as Row).cycleId));
    const admit = db.prepare("UPDATE domus_observations SET admission_state='admitted' WHERE observation_id=? AND admission_state='stored'");
    for (const observationId of observationIds) admit.run(observationId);
    // Older rows of this attachment that did not fit, or expired while waiting, are dropped, never admitted later.
    db.prepare(`UPDATE domus_observations SET admission_state='dropped' WHERE attachment=? AND admission_state='stored'
      AND (receipt_time_ms < ? OR expires_at_ms <= ?)`).run(attachment, Number(included[0]!.receipt_time_ms), input.nowMs);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  const reservation = getPrivateReservationForWake(db, event.wakeId!) ?? reservePrivateThought(db, { admissionId: id, wakeId: event.wakeId!,
    conversationId: input.conversationId, policyId: EMBODIMENT_POLICY_ID, wallClockNowMs: input.nowMs });
  if ("reservation" in reservation || "reservationId" in reservation) db.prepare("UPDATE inbox_events SET next_eligible_at_ms=NULL WHERE id=? AND state='pending'").run(id);
  return { kind: "selected" as const, event, reservation };
}

/** An admitted Domus pass whose reservation did not land (clock or capacity race) is retried, never re-admitted. */
export function repairDomusReservations(db: DatabaseSync, input: { conversationId: string; nowMs: number }): number {
  let repaired = 0;
  const rows = db.prepare(`SELECT id, wake_id FROM inbox_events WHERE conversation_id=? AND kind='domus_notification'
    AND state='pending' AND next_eligible_at_ms=? LIMIT 8`).all(input.conversationId, Number.MAX_SAFE_INTEGER) as Row[];
  for (const row of rows) {
    if (typeof row.wake_id !== "string") continue;
    if (!getPrivateReservationForWake(db, row.wake_id)) {
      const admission = reservePrivateThought(db, { admissionId: String(row.id), wakeId: row.wake_id, conversationId: input.conversationId,
        policyId: EMBODIMENT_POLICY_ID, wallClockNowMs: input.nowMs });
      if (admission.kind !== "reserved" && admission.kind !== "existing") continue;
    }
    db.prepare("UPDATE inbox_events SET next_eligible_at_ms=NULL WHERE id=? AND state='pending'").run(String(row.id));
    repaired++;
  }
  return repaired;
}

function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), "utf8"); }

function boundNotification(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string) {
  const origin = originCycleId ? getCycle(db, originCycleId) : null;
  if (originCycleId && (!origin || origin.triggerKind !== "domus_notification" || origin.conversationId !== event.conversationId)) throw new Error("domus_notification_origin_invalid");
  const persisted = getInboxEvent(db, origin?.triggerRef ?? event.id);
  if (!persisted || persisted.kind !== "domus_notification" || persisted.conversationId !== event.conversationId) throw new Error("domus_notification_missing");
  const bound = (persisted.payload as Row).domus as { world?: unknown; observationIds?: unknown } | undefined;
  if (!bound || typeof bound.world !== "string" || !bound.world || !Array.isArray(bound.observationIds)) throw new Error("domus_notification_invalid");
  const attachment = (bound as { attachment?: unknown }).attachment;
  return { world: bound.world, observationIds: bound.observationIds.map(String), eventId: persisted.id, createdAtMs: persisted.createdAtMs,
    ...(typeof attachment === "string" && attachment ? { attachment } : {}) };
}

/** The memory channel of a Domus pass, for its journal entry. */
export function domusChannelFor(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string): { channel?: `domus:${string}` } {
  try { return { channel: `domus:${boundNotification(db, event, originCycleId).world}` }; } catch { return {}; }
}

/** 8f: the row whose options a Domus pass may choose from (none when acting is off or nothing was offered). */
export function domusActBindingFor(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string): DomusActBinding | undefined {
  try { return domusActBinding(db, boundNotification(db, event, originCycleId)); } catch { return undefined; }
}

/** Re-read the bound inbox event and the durable rows; never project the caller's payload. Undone rows are left out. */
function textList(value: unknown, key: string | null, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => key === null ? item : item && typeof item === "object" ? (item as Row)[key] : undefined)
    .filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, limit).map(item => item.slice(0, 120));
}

/** The facts of a portrait a conversation needs: when and where, how her body feels, what it is doing,
 * who is there, her jobs, and what the game is asking her. The game's own words; nothing added. */
export function compactDomusBody(portrait: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ["time", "place", "mood", "paused"]) if (portrait[key] !== undefined) body[key] = portrait[key];
  const needs = portrait.needs;
  if (needs && typeof needs === "object" && !Array.isArray(needs)) {
    body.needs = Object.fromEntries(Object.entries(needs as Row)
      .map(([need, value]) => [need, value && typeof value === "object" ? (value as Row).band : undefined])
      .filter(([, band]) => typeof band === "string"));
  }
  const feelings = textList(portrait.moodlets, "text", 6);
  if (feelings.length) body.feelings = feelings;
  const doing = textList(portrait.running, null, 4);
  if (doing.length) body.doing = doing;
  const company = textList(portrait.company, "name", 6);
  if (company.length) body.with = company;
  const self = portrait.self;
  const jobs = self && typeof self === "object" ? (self as Row).jobs : undefined;
  if (Array.isArray(jobs) && jobs.length) body.jobs = jobs.slice(0, 4);
  const asked = textList(portrait.asked, "title", 2);
  if (asked.length) body.asked = asked;
  for (const key of ["with", "feelings", "doing"]) {
    if (bytes(body) <= DOMUS_NOW_BYTES) break;
    delete body[key];
  }
  return bytes(body) <= DOMUS_NOW_BYTES ? body : {};
}

/** M5: the newest word from the game within DOMUS_NOW_WINDOW_MS, or nothing. live: the game is attached now. */
export function domusNowForThought(db: DatabaseSync, nowMs: number): DomusNow | undefined {
  let row: Row | undefined;
  try {
    row = db.prepare(`SELECT world, attachment, source_time_ms, payload_json FROM domus_observations
      WHERE admission_state != 'dropped' AND undone_at_ms IS NULL AND receipt_time_ms >= ? AND receipt_time_ms <= ?
      ORDER BY receipt_time_ms DESC, seq DESC LIMIT 1`).get(nowMs - DOMUS_NOW_WINDOW_MS, nowMs) as Row | undefined;
  } catch { return undefined; }
  if (!row) return undefined;
  let portrait: unknown;
  try { portrait = (JSON.parse(String(row.payload_json)) as { portrait?: unknown }).portrait; } catch { return undefined; }
  if (!portrait || typeof portrait !== "object" || Array.isArray(portrait)) return undefined;
  const body = compactDomusBody(portrait as Record<string, unknown>);
  if (!Object.keys(body).length) return undefined;
  return { world: String(row.world), asOfMs: Number(row.source_time_ms),
    live: armedAttachments(db, nowMs).has(String(row.attachment)), body };
}

export function domusForThought(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string,
  acting: { enabled: boolean; nowMs: number } = { enabled: false, nowMs: 0 }): DomusForThought {
  const bound = boundNotification(db, event, originCycleId);
  const read = db.prepare(`SELECT observation_id, world, source_time_ms, payload_json FROM domus_observations
    WHERE observation_id = ? AND admission_state = 'admitted' AND undone_at_ms IS NULL`);
  const rows = bound.observationIds.map(observationId => read.get(String(observationId)) as Row | undefined)
    .filter((row): row is Row => row !== undefined && row.world === bound.world);
  const all: DomusEvent[] = rows.flatMap(row => percepts(row.payload_json).map(item => ({
    observationId: String(row.observation_id), atMs: Number(row.source_time_ms), kind: String(item.kind),
    facts: item.facts && typeof item.facts === "object" ? item.facts : {} })));
  const events: DomusEvent[] = [];
  let used = 2;
  for (let index = all.length - 1; index >= 0; index--) {
    const size = bytes(all[index]) + 1;
    if (used + size > DOMUS_EVENTS_BYTES) break;
    events.unshift(all[index]!);
    used += size;
  }
  let portrait: Record<string, unknown> | undefined;
  for (let index = rows.length - 1; index >= 0 && portrait === undefined; index--) {
    try {
      const value = (JSON.parse(String(rows[index]!.payload_json)) as { portrait?: unknown }).portrait;
      if (value && typeof value === "object" && !Array.isArray(value)) portrait = value as Record<string, unknown>;
    } catch { /* a row without a readable portrait offers none */ }
  }
  const options = acting.enabled ? domusOptionsFor(db, domusActBinding(db, bound)) : [];
  const acts = acting.enabled ? recentDomusActs(db, bound.world, acting.nowMs) : [];
  let changes: DomusChanges = { first: true };
  const previous = bound.attachment ? previousDomusRead(db, { conversationId: event.conversationId, eventId: bound.eventId,
    attachment: bound.attachment, createdAtMs: bound.createdAtMs }) : undefined;
  const before = previous && previous.world === bound.world ? domusReadOf(db, bound.world, previous.observationIds) : undefined;
  if (previous && before) {
    changes = { sinceMs: before.sourceTimeMs, ...compareDomusReads({ portrait: before.portrait, options: acting.enabled ? before.options : [] },
      { portrait: portrait ?? {}, options }, { actNews: domusActNewsSince(db, bound.world, previous.createdAtMs, Math.max(acting.nowMs, bound.createdAtMs)),
        perceptKinds: all.map(item => item.kind), urgent: all.some(item => item.facts.urgency === "always_through") }) };
  }
  return {
    world: bound.world,
    asOfMs: rows.length ? Math.max(...rows.map(row => Number(row.source_time_ms))) : 0,
    observationIds: rows.map(row => String(row.observation_id)),
    changes,
    ...(portrait ? { portrait } : {}),
    events,
    ...(all.length > events.length ? { omittedEvents: all.length - events.length } : {}),
    ...(options.length ? { options } : {}),
    ...(acts.length ? { acts } : {}),
  };
}

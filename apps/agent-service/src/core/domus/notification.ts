// 8d: a stored Domus observation becomes one private Domus pass. The thalamus selects, the embodiment
// budget pays, the inbox carries it, and Thought reads a portrait rebuilt from the durable rows.
import { DOMUS_GAME_ONLY } from "./lane.js";
import type { DatabaseSync } from "node:sqlite";
import { appendInboxEventInTransaction, getCycle, getInboxEvent } from "../cognitive-v021/cycle/inbox.js";
import { configureBudgetPolicy, resolveBudgetPolicy, PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS } from "../cognitive-v021/private-budget/policies.js";
import { getPrivateBudgetProjection, getPrivateReservationForWake, reservePrivateThought } from "../cognitive-v021/private-budget/ledger.js";
import type { DomusPending } from "../cognitive-v021/thalamus/nuclei/domus.js";
import { domusActBinding, domusNoWayObjects, domusOptionsFor, optionsOf, recentDomusActs, type DomusActBinding, type DomusOptionObject, type DomusRecentAct } from "./acts.js";
import { compareDomusReads, domusActNewsSince, domusReadOf, previousDomusRead, type DomusChanges } from "./changes.js";
import { domusSnapshotFacts, type DomusSnapshotFact } from "./snapshots.js";
import { domusPromisesOpen, type DomusPromiseFact } from "./promises.js";

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
export type DomusNow = {
  world: string; asOfMs: number; live: boolean; body: Record<string, unknown>;
  /** DPLAY: while the game is live, an Owner turn reads what her body can do now and what became of her acts. */
  options?: DomusOptionObject[]; acts?: DomusRecentAct[];
  /** SNAPSHOT: what became of her recent pictures of the game, when there were any. */
  snapshots?: DomusSnapshotFact[];
  /** DASK: what she promised the Owner about the house and has not settled yet, when there is any (her own words). */
  promises?: DomusPromiseFact[];
};
/** DPLAY: the newest menu of a live game an Owner turn may act from (older menus are not offered). */
export const DOMUS_LIVE_OPTIONS_MS = 10 * 60 * 1000;
export type DomusLive = { binding: DomusActBinding; options: DomusOptionObject[]; acts: DomusRecentAct[] };

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
  /** M3: what the game taught her in this world (memories with game supports only), best match first. */
  lessons?: DomusLesson[];
  /** DASK: what she promised the Owner about the house and has not settled yet, oldest first (her own words). */
  promises?: DomusPromiseFact[];
};

export type DomusLesson = { key: string; lesson: string; kind: string; seen: number };
export const DOMUS_LESSONS_MAX = 5;
export const DOMUS_LESSONS_BYTES = 1536;

const LESSON_STOP = new Set(["the", "and", "for", "with", "from", "your", "you", "her", "his", "this", "that"]);

/** Words of length ≥ 3, lowercased, stop words dropped. Splits on non-alphanumerics and camelCase. */
function lessonWords(text: string): string[] {
  const split = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words: string[] = [];
  for (const raw of split.split(/[^A-Za-z0-9]+/)) {
    const word = raw.toLowerCase();
    if (word.length >= 3 && !LESSON_STOP.has(word)) words.push(word);
  }
  return words;
}

function pushStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) { for (const item of value) pushStrings(item, into); }
  else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (typeof item === "string") into.push(item);
    }
  }
}

/** Words that say what is in front of her: her options (objects and acts), what her body is doing or
 * queued, who is with her, her moodlets and their reasons, and what the game is asking. */
export function domusSceneTerms(domus: Pick<DomusForThought, "portrait" | "options">): Set<string> {
  const portrait = domus.portrait ?? {};
  const texts: string[] = [];
  pushStrings(portrait.running, texts);
  pushStrings(portrait.queued, texts);
  const company = portrait.company;
  if (Array.isArray(company)) for (const person of company) {
    if (person && typeof person === "object" && typeof (person as Row).name === "string") texts.push(String((person as Row).name));
  }
  const moodlets = portrait.moodlets;
  if (Array.isArray(moodlets)) for (const mood of moodlets) {
    if (!mood || typeof mood !== "object") continue;
    const row = mood as Row;
    if (typeof row.text === "string") texts.push(row.text);
    if (typeof row.reason === "string") texts.push(row.reason);
  }
  const asked = portrait.asked;
  if (Array.isArray(asked)) for (const item of asked) {
    if (item && typeof item === "object" && typeof (item as Row).title === "string") texts.push(String((item as Row).title));
  }
  const notebook = portrait.notebook;
  if (notebook && typeof notebook === "object") {
    const procedures = (notebook as Row).procedures;
    if (Array.isArray(procedures)) for (const procedure of procedures) {
      if (procedure && typeof procedure === "object" && typeof (procedure as Row).interaction === "string") {
        texts.push(String((procedure as Row).interaction));
      }
    }
  }
  for (const option of domus.options ?? []) {
    texts.push(option.object);
    if (option.where) texts.push(option.where);
    for (const act of option.acts) texts.push(act.text);
  }
  return new Set(texts.flatMap(lessonWords));
}

/** Her lessons from this world: live memories on `domus:<world>` that no Discord support touches. */
export function domusLessonsFor(db: DatabaseSync, world: string, terms: Set<string>): DomusLesson[] {
  try {
    const columns = db.prepare("PRAGMA table_info(sidecar_memory_assertions)").all() as Array<{ name?: string }>;
    const lineage = columns.some(column => column.name === "lineage_class");
    const rows = db.prepare(`SELECT a.assertion_key, a.statement, a.memory_kind,
       (SELECT COUNT(*) FROM sidecar_memory_supports s WHERE s.assertion_key = a.assertion_key) AS seen
  FROM sidecar_memory_assertions a
 WHERE a.live = 1 AND a.channel = ? AND a.data_classification <> 'secret'
   ${lineage ? "AND a.lineage_class = 'current'" : ""}
   AND NOT EXISTS (SELECT 1 FROM sidecar_memory_supports s
                    WHERE s.assertion_key = a.assertion_key AND s.channel = 'discord')`).all(`domus:${world}`) as Row[];
    const ranked = rows.map(row => {
      const words = new Set(lessonWords(String(row.statement ?? "")));
      let score = 0;
      for (const term of terms) if (words.has(term)) score += 1;
      return { row, score, seen: Number(row.seen) || 0, key: String(row.assertion_key) };
    });
    ranked.sort((left, right) => right.score - left.score || right.seen - left.seen || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    const lessons: DomusLesson[] = ranked.slice(0, DOMUS_LESSONS_MAX).map(item => ({
      key: item.key,
      lesson: String(item.row.statement ?? "").slice(0, 300),
      kind: String(item.row.memory_kind ?? ""),
      seen: item.seen,
    }));
    while (lessons.length && Buffer.byteLength(JSON.stringify(lessons)) > DOMUS_LESSONS_BYTES) lessons.pop();
    return lessons;
  } catch { return []; }
}

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

/** E1b: the Owner can keep his conversations out of her game passes. The helper on his PC carries
 * the switch in its heartbeat; a pass admitted while it is on is stamped game-only for good. */
export { DOMUS_GAME_ONLY };

export function gameOnlyInputs(db: DatabaseSync, attachment: string): boolean {
  const row = db.prepare("SELECT last_json FROM domus_heartbeats WHERE helper_session = ?").get(attachment) as Row | undefined;
  try { return (JSON.parse(String(row?.last_json)) as { inputs?: unknown }).inputs === DOMUS_GAME_ONLY; } catch { return false; }
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

/** The selected cycle and timing receipt commit together with the rows' admission; disarmed or unpaid work is deferred.
 * E1: conversationId is the game lane; homeConversationId is the Owner's thread, where her words from the game go. */
export function selectDomusNotification(db: DatabaseSync, input: {
  observationId: string; conversationId: string; homeConversationId?: string; ownerId: string; authorityEpoch: number; nowMs: number;
  bind: (cycleId: string) => void;
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
      payload: { domus: { world: String(newest.world), attachment, observationIds }, occupantId: input.ownerId, authorityEpoch: input.authorityEpoch,
        ...(gameOnlyInputs(db, attachment) ? { inputs: DOMUS_GAME_ONLY } : {}),
        ...(input.homeConversationId && input.homeConversationId !== input.conversationId
          ? { channel: "discord", threadId: input.homeConversationId } : {}) },
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

/** E1: the Owner's thread a game-lane pass belongs to (none for a pass in the Owner's own thread). */
export function domusHomeFor(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string): string | undefined {
  try {
    const persisted = getInboxEvent(db, boundNotification(db, event, originCycleId).eventId);
    const threadId = (persisted?.payload as Row | undefined)?.threadId;
    return typeof threadId === "string" && threadId && threadId !== event.conversationId ? threadId : undefined;
  } catch { return undefined; }
}

/** E1b: whether this pass was admitted with game-only inputs. */
export function domusGameOnlyFor(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string): boolean {
  try {
    const persisted = getInboxEvent(db, boundNotification(db, event, originCycleId).eventId);
    return (persisted?.payload as Row | undefined)?.inputs === DOMUS_GAME_ONLY;
  } catch { return false; }
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
 * who is there, her jobs, what she wants and fears, and what the game is asking her. The game's own words; nothing added. */
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
  // 2.30.0: what she wants and fears now, in the game's words; a want without text is no fact to report.
  const wantRows = self && typeof self === "object" ? (self as Row).wants : undefined;
  const wants = Array.isArray(wantRows)
    ? wantRows.flatMap((row) => {
        if (!row || typeof row !== "object" || typeof (row as Row).want !== "string") return [];
        const { want, fear } = row as Row;
        return [{ want: (want as string).slice(0, 120), ...(fear === true ? { fear: true } : {}) }];
      }).slice(0, 5)
    : [];
  if (wants.length) body.wants = wants;
  const asked = textList(portrait.asked, "title", 2);
  if (asked.length) body.asked = asked;
  // SS1: social talk as plain sentences where the phrase data has one (hers, then to her).
  const said = [...textList(portrait.doing_said, "sentence", 3), ...textList(portrait.addressed_by, "sentence", 3)];
  if (said.length) body.said = said;
  for (const key of ["said", "with", "feelings", "doing", "wants"]) {
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
  const snapshots = domusSnapshotFacts(db, nowMs);
  const promises = domusPromisesOpen(db, nowMs);
  return { world: String(row.world), asOfMs: Number(row.source_time_ms),
    live: armedAttachments(db, nowMs).has(String(row.attachment)), body, ...(snapshots.length ? { snapshots } : {}),
    ...(promises.length ? { promises } : {}) };
}

/** UX W3: a game attached now, and her Sim's mood as the game names it in that session's newest portrait. */
export type DomusGameNow = { live: true; mood: string | null };

export function domusGameNow(db: DatabaseSync, nowMs: number): DomusGameNow | undefined {
  let armed: Set<string>;
  try { armed = armedAttachments(db, nowMs); } catch { return undefined; }
  if (!armed.size) return undefined;
  let rows: Row[];
  try {
    rows = db.prepare(`SELECT attachment, json_extract(payload_json, '$.portrait.mood') AS mood FROM domus_observations
      WHERE undone_at_ms IS NULL AND receipt_time_ms >= ? AND receipt_time_ms <= ?
        AND json_extract(payload_json, '$.portrait.mood') IS NOT NULL
      ORDER BY receipt_time_ms DESC, seq DESC LIMIT 64`).all(nowMs - DOMUS_NOW_WINDOW_MS, nowMs) as Row[];
  } catch { return { live: true, mood: null }; }
  const row = rows.find(item => armed.has(String(item.attachment)) && typeof item.mood === "string" && item.mood.length > 0);
  return { live: true, mood: row ? String(row.mood).slice(0, 64) : null };
}

/**
 * DPLAY: the User talks with her on Discord while she plays. Her Discord turn reads the newest menu of
 * the game that is live now and may act from it, the same way a game pass does. Nothing when acting is
 * off, no game is attached, or its newest menu is older than DOMUS_LIVE_OPTIONS_MS.
 */
export function domusLiveForOwner(db: DatabaseSync, nowMs: number): DomusLive | undefined {
  const armed = armedAttachments(db, nowMs);
  if (!armed.size) return undefined;
  let rows: Row[];
  try {
    rows = db.prepare(`SELECT observation_id, world, attachment, payload_json FROM domus_observations
      WHERE admission_state != 'dropped' AND undone_at_ms IS NULL AND receipt_time_ms >= ? AND receipt_time_ms <= ?
      ORDER BY receipt_time_ms DESC, seq DESC LIMIT 64`).all(nowMs - DOMUS_LIVE_OPTIONS_MS, nowMs) as Row[];
  } catch { return undefined; }
  for (const row of rows) {
    if (!armed.has(String(row.attachment))) continue;
    const listed = optionsOf(row.payload_json);
    if (!listed.length) continue;
    const binding: DomusActBinding = { world: String(row.world), attachment: String(row.attachment), observationId: String(row.observation_id) };
    const noWay = domusNoWayObjects(db, binding.world, nowMs);
    const options = listed.map(item => noWay.has(item.object_id) && item.noWay === undefined
      ? { ...item, noWay: `last time ${noWay.get(item.object_id)}` } : item);
    return { binding, options, acts: recentDomusActs(db, binding.world, nowMs) };
  }
  return undefined;
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
  const listed = acting.enabled ? domusOptionsFor(db, domusActBinding(db, bound)) : [];
  // An object where an act of hers never began because the game found no way there says so, until something there runs;
  // the helper's own noWay (the game sees no way there now) is kept as it came.
  const noWay = listed.length ? domusNoWayObjects(db, bound.world, acting.nowMs) : new Map<string, string>();
  const options = listed.map(item => noWay.has(item.object_id) && item.noWay === undefined
    ? { ...item, noWay: `last time ${noWay.get(item.object_id)}` } : item);
  const acts = acting.enabled ? recentDomusActs(db, bound.world, acting.nowMs) : [];
  const lessons = domusLessonsFor(db, bound.world, domusSceneTerms({ portrait, options }));
  // DASK: her promises to the Owner are shown in every game pass, acting or watching, at the pass's own time.
  const promises = domusPromisesOpen(db, acting.nowMs);
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
    ...(lessons.length ? { lessons } : {}),
    ...(promises.length ? { promises } : {}),
  };
}

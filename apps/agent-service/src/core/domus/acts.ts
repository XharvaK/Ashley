// 8f (direct): Ashley acts in the Sims world. Her Thought names one option the helper listed in the
// pass she read; the Host resolves it from that durable row (no matcher), keeps it as a requested
// act, and the helper pulls it. What happened comes back as append-only events: the helper received
// it, the probe accepted or rejected it, the game ran it and how it finished, or nobody knows.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** A requested act not picked up by its helper within this time expires; the game never sees it. */
export const DOMUS_ACT_TTL_MS = 90_000;
/** Her own recent acts in the portrait: this many, from this far back. */
export const DOMUS_RECENT_ACTS = 6;
export const DOMUS_RECENT_ACTS_MS = 2 * 60 * 60 * 1000;

export type DomusActClaim = { option: string };
export type DomusOptionAct = { ref: string; guid64: string; text: string };
export type DomusOptionObject = { object: string; object_id: string; where?: string; acts: DomusOptionAct[] };
export type DomusActBinding = { world: string; attachment: string; observationId: string };
export type DomusActPhase = "received" | "accepted" | "rejected" | "pushed" | "finished" | "unknown" | "expired";
export type DomusActEvent = { actId: string; phase: DomusActPhase; atMs: number; detail?: Record<string, unknown> };
export type DomusRecentAct = {
  option: string; label: string; state: string; requestedAtMs: number; updatedAtMs: number; detail?: Record<string, unknown>;
};

const PHASES: ReadonlySet<string> = new Set(["received", "accepted", "rejected", "pushed", "finished", "unknown", "expired"]);
/** Terminal states never move again; a late event is still appended (the record keeps what arrived). */
const TERMINAL: ReadonlySet<string> = new Set(["rejected", "finished", "unknown", "expired", "invalid"]);
const RANK: Record<string, number> = { requested: 0, received: 1, accepted: 2, pushed: 3 };

type Row = Record<string, unknown>;

export function isDomusActClaim(value: unknown): value is DomusActClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => key === "option") && typeof record.option === "string"
    && /^[A-Za-z0-9._-]{1,16}$/.test(record.option);
}

/** The options of one stored observation, exactly as the helper sent them; anything malformed offers nothing. */
export function optionsOf(payloadJson: unknown): DomusOptionObject[] {
  try {
    const options = (JSON.parse(String(payloadJson)) as { options?: unknown }).options;
    if (!Array.isArray(options)) return [];
    return options.filter((item): item is DomusOptionObject => !!item && typeof item === "object"
      && typeof (item as Row).object === "string" && typeof (item as Row).object_id === "string"
      && Array.isArray((item as Row).acts));
  } catch { return []; }
}

function findOption(options: readonly DomusOptionObject[], ref: string) {
  for (const object of options) {
    for (const act of object.acts) {
      if (act && typeof act === "object" && act.ref === ref && typeof act.guid64 === "string" && typeof act.text === "string") {
        return { object, act };
      }
    }
  }
  return null;
}

/** The newest admitted row of a pass that carries options: what she could choose from. */
export function domusActBinding(db: DatabaseSync, input: { world: string; observationIds: readonly string[] }): DomusActBinding | undefined {
  const read = db.prepare(`SELECT observation_id, world, attachment, payload_json FROM domus_observations
    WHERE observation_id = ? AND admission_state = 'admitted' AND undone_at_ms IS NULL`);
  for (let index = input.observationIds.length - 1; index >= 0; index--) {
    const row = read.get(String(input.observationIds[index])) as Row | undefined;
    if (!row || row.world !== input.world) continue;
    if (optionsOf(row.payload_json).length) {
      return { world: input.world, attachment: String(row.attachment), observationId: String(row.observation_id) };
    }
  }
  return undefined;
}

/** The options of a bound pass (for her input), or none. */
export function domusOptionsFor(db: DatabaseSync, binding: DomusActBinding | undefined): DomusOptionObject[] {
  if (!binding) return [];
  const row = db.prepare("SELECT payload_json FROM domus_observations WHERE observation_id = ?").get(binding.observationId) as Row | undefined;
  return row ? optionsOf(row.payload_json) : [];
}

/**
 * Keep her choice as a requested act, once per settled cycle. A ref that is not on the list she
 * read is kept as invalid (she is told next time); nothing is guessed or substituted.
 */
export function recordDomusAct(db: DatabaseSync, input: {
  binding: DomusActBinding; claim: DomusActClaim; cycleId: string; nowMs: number;
}): { actId: string; state: "requested" | "invalid" } {
  const existing = db.prepare("SELECT act_id, state FROM domus_acts WHERE cycle_id = ?").get(input.cycleId) as Row | undefined;
  if (existing) return { actId: String(existing.act_id), state: existing.state === "invalid" ? "invalid" : "requested" };
  const found = findOption(domusOptionsFor(db, input.binding), input.claim.option);
  const actId = randomUUID().replaceAll("-", "");
  db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id, guid64,
    label, state, requested_at_ms, expires_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    actId, input.cycleId, input.binding.world, input.binding.attachment, input.binding.observationId, input.claim.option,
    found ? found.object.object_id : null, found ? found.act.guid64 : null,
    found ? `${found.act.text} (${found.object.object})`.slice(0, 200) : "",
    found ? "requested" : "invalid", input.nowMs, input.nowMs + DOMUS_ACT_TTL_MS, input.nowMs);
  return { actId, state: found ? "requested" : "invalid" };
}

function nextState(current: string, phase: string): string | null {
  if (TERMINAL.has(current)) return null;
  if (phase in RANK) return RANK[phase]! > (RANK[current] ?? -1) ? phase : null;
  return phase;
}

/**
 * One helper round trip: its events are appended (only for acts of its own attachment) and the
 * acts still to run are returned. A requested act past its expiry is expired here, never sent.
 */
export function syncDomusActs(db: DatabaseSync, input: {
  helperSession: string; events: readonly DomusActEvent[]; nowMs: number;
}): { acts: Array<{ act_id: string; object_id: string; guid64: string; expires_at_ms: number }>; applied: number } {
  let applied = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const read = db.prepare("SELECT state FROM domus_acts WHERE act_id = ? AND attachment = ?");
    const append = db.prepare("INSERT OR IGNORE INTO domus_act_events (act_id, phase, at_ms, received_at_ms, detail_json) VALUES (?, ?, ?, ?, ?)");
    const move = db.prepare("UPDATE domus_acts SET state = ?, updated_at_ms = ? WHERE act_id = ?");
    for (const event of input.events) {
      const row = read.get(event.actId, input.helperSession) as Row | undefined;
      if (!row) continue;
      const inserted = append.run(event.actId, event.phase, event.atMs, input.nowMs, JSON.stringify(event.detail ?? {}));
      if (Number(inserted.changes) === 0) continue;
      applied++;
      const next = nextState(String(row.state), event.phase);
      if (next) move.run(next, input.nowMs, event.actId);
    }
    const stale = db.prepare("SELECT act_id FROM domus_acts WHERE state = 'requested' AND expires_at_ms <= ?").all(input.nowMs) as Row[];
    for (const row of stale) {
      append.run(String(row.act_id), "expired", input.nowMs, input.nowMs, "{}");
      move.run("expired", input.nowMs, String(row.act_id));
    }
    // Live 2026-10-06: a meal pushed in one game session never finished, and she still waited
    // for it the next day. Only an act's own helper session may report on it, so once another
    // session syncs, an act still in flight from an earlier one can never be told: unknown.
    const orphaned = db.prepare(`SELECT act_id FROM domus_acts WHERE attachment != ?
      AND state IN ('received','accepted','pushed')`).all(input.helperSession) as Row[];
    for (const row of orphaned) {
      append.run(String(row.act_id), "unknown", input.nowMs, input.nowMs, JSON.stringify({ code: "SESSION_ENDED" }));
      move.run("unknown", input.nowMs, String(row.act_id));
    }
    const acts = (db.prepare(`SELECT act_id, object_id, guid64, expires_at_ms FROM domus_acts
      WHERE attachment = ? AND state = 'requested' AND expires_at_ms > ? ORDER BY requested_at_ms`).all(input.helperSession, input.nowMs) as Row[])
      .map(row => ({ act_id: String(row.act_id), object_id: String(row.object_id), guid64: String(row.guid64), expires_at_ms: Number(row.expires_at_ms) }));
    db.exec("COMMIT");
    return { acts, applied };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Her own recent acts in this world, newest last, with the latest thing known about each. */
export function recentDomusActs(db: DatabaseSync, world: string, nowMs: number): DomusRecentAct[] {
  const rows = db.prepare(`SELECT act_id, option_ref, label, state, requested_at_ms, updated_at_ms FROM domus_acts
    WHERE world = ? AND requested_at_ms >= ? ORDER BY requested_at_ms DESC LIMIT ?`).all(world, nowMs - DOMUS_RECENT_ACTS_MS, DOMUS_RECENT_ACTS) as Row[];
  const detail = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = ? ORDER BY at_ms DESC LIMIT 1");
  return rows.reverse().map(row => {
    let extra: Record<string, unknown> | undefined;
    try {
      const found = detail.get(String(row.act_id), String(row.state)) as Row | undefined;
      const parsed = found ? JSON.parse(String(found.detail_json)) as Record<string, unknown> : {};
      if (Object.keys(parsed).length) extra = parsed;
    } catch { /* no detail */ }
    return {
      option: String(row.option_ref), label: String(row.label), state: String(row.state),
      requestedAtMs: Number(row.requested_at_ms), updatedAtMs: Number(row.updated_at_ms), ...(extra ? { detail: extra } : {}),
    };
  });
}

export function isDomusActPhase(value: unknown): value is DomusActPhase {
  return typeof value === "string" && PHASES.has(value);
}

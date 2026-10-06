// 8f (direct): Ashley acts in the Sims world. Her Thought names one option the helper listed in the
// pass she read; the Host resolves it from that durable row (no matcher), keeps it as a requested
// act, and the helper pulls it. What happened comes back as append-only events: the helper received
// it, the probe accepted or rejected it, the game ran it and how it finished, or nobody knows.
// H0.5: she may plan up to two more acts after the first (`then`). Each waits until the one before
// finished and is then requested like any act; a refusal or an unknown ends the plan, a wake (someone
// arrives, the game asks, a need drops) drops the rest, and a new choice replaces it.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** A requested act not picked up by its helper within this time expires; the game never sees it. */
export const DOMUS_ACT_TTL_MS = 90_000;
/** Her own recent acts in the portrait: this many, from this far back. */
export const DOMUS_RECENT_ACTS = 6;
export const DOMUS_RECENT_ACTS_MS = 2 * 60 * 60 * 1000;
/** A plan is the first act and at most this many more. */
export const DOMUS_PLAN_MORE = 2;

export type DomusActClaim = { option: string; then?: string[] };
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

const REF = /^[A-Za-z0-9._-]{1,16}$/;

export function isDomusActClaim(value: unknown): value is DomusActClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => key === "option" || key === "then") && typeof record.option === "string"
    && REF.test(record.option)
    && (record.then === undefined || (Array.isArray(record.then) && record.then.length >= 1 && record.then.length <= DOMUS_PLAN_MORE
      && record.then.every(ref => typeof ref === "string" && REF.test(ref))));
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
  const options = domusOptionsFor(db, input.binding);
  const found = findOption(options, input.claim.option);
  const actId = randomUUID().replaceAll("-", "");
  // A new choice replaces whatever was still waiting in an earlier plan.
  dropPlannedSteps(db, { world: input.binding.world, reason: "replaced", nowMs: input.nowMs });
  db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id, guid64,
    label, state, requested_at_ms, expires_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    actId, input.cycleId, input.binding.world, input.binding.attachment, input.binding.observationId, input.claim.option,
    found ? found.object.object_id : null, found ? found.act.guid64 : null,
    found ? labelOf(found) : "",
    found ? "requested" : "invalid", input.nowMs, input.nowMs + DOMUS_ACT_TTL_MS, input.nowMs);
  const step = db.prepare(`INSERT INTO domus_plan_steps (plan_id, step, world, attachment, option_ref, object_id, guid64, label,
    state, reason, planned_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let broken: string | null = found ? null : "after_invalid";
  (input.claim.then ?? []).slice(0, DOMUS_PLAN_MORE).forEach((ref, index) => {
    const next = findOption(options, ref);
    const state = broken ? "dropped" : next ? "planned" : "invalid";
    step.run(actId, index + 1, input.binding.world, input.binding.attachment, ref, next ? next.object.object_id : null,
      next ? next.act.guid64 : null, next ? labelOf(next) : "", state, broken, input.nowMs, input.nowMs);
    if (!next && !broken) broken = "after_invalid";
  });
  return { actId, state: found ? "requested" : "invalid" };
}

function labelOf(found: { object: DomusOptionObject; act: DomusOptionAct }): string {
  return `${found.act.text} (${found.object.object})`.slice(0, 200);
}

/** Steps still waiting are let go (a new choice, a wake, a session that ended); released ones run their course. */
function dropPlannedSteps(db: DatabaseSync, input: { world?: string; attachment?: string; otherThan?: string; reason: string; nowMs: number }): number {
  const where = input.world !== undefined ? "world = ?" : input.attachment !== undefined ? "attachment = ?" : "attachment != ?";
  const value = input.world ?? input.attachment ?? input.otherThan ?? "";
  return Number(db.prepare(`UPDATE domus_plan_steps SET state = 'dropped', reason = ?, updated_at_ms = ?
    WHERE state = 'planned' AND ${where}`).run(input.reason, input.nowMs, value).changes ?? 0);
}

/** Percepts that wake her for something new (not her own act ending, not a slow check) end a plan. */
const NOT_INTERRUPTING: ReadonlySet<string> = new Set(["idle", "check"]);

export function isInterruptingPercept(percept: unknown): boolean {
  const facts = (percept as { facts?: Record<string, unknown> } | null)?.facts;
  if (!facts || typeof facts !== "object") return false;
  return (facts.urgency === "wake" || facts.urgency === "always_through")
    && !NOT_INTERRUPTING.has(String(facts.bucket)) && facts.object !== "check";
}

/** H0.5: an observation that wakes her for something new drops what is still waiting in her plan there. */
export function interruptDomusPlans(db: DatabaseSync, input: { attachment: string; percepts: readonly unknown[]; nowMs: number }): number {
  const cause = input.percepts.find(isInterruptingPercept) as { kind?: string; facts?: Record<string, unknown> } | undefined;
  if (!cause) return 0;
  const what = `${String(cause.kind ?? "event")}:${String(cause.facts?.bucket ?? "")}`.slice(0, 64);
  return dropPlannedSteps(db, { attachment: input.attachment, reason: `woken_by:${what}`, nowMs: input.nowMs });
}

/** Release the next step of each plan whose previous act finished; a plan whose previous act failed ends there. */
function releasePlanSteps(db: DatabaseSync, helperSession: string, nowMs: number): void {
  const steps = db.prepare(`SELECT s.plan_id, s.step, s.option_ref, s.object_id, s.guid64, s.label, a.cycle_id, a.world,
    a.attachment, a.observation_id FROM domus_plan_steps s JOIN domus_acts a ON a.act_id = s.plan_id
    WHERE s.attachment = ? AND s.state = 'planned' ORDER BY s.plan_id, s.step`).all(helperSession) as Row[];
  const previous = db.prepare(`SELECT a.state FROM domus_plan_steps s JOIN domus_acts a ON a.act_id = s.act_id
    WHERE s.plan_id = ? AND s.step = ?`);
  const head = db.prepare("SELECT state FROM domus_acts WHERE act_id = ?");
  const prevStep = db.prepare("SELECT state FROM domus_plan_steps WHERE plan_id = ? AND step = ?");
  const insert = db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id,
    guid64, label, state, requested_at_ms, expires_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`);
  const mark = db.prepare("UPDATE domus_plan_steps SET state = ?, act_id = ?, reason = ?, updated_at_ms = ? WHERE plan_id = ? AND step = ?");
  for (const row of steps) {
    const planId = String(row.plan_id);
    const step = Number(row.step);
    let before: string | undefined;
    if (step === 1) before = (head.get(planId) as Row | undefined)?.state as string | undefined;
    else {
      const stepState = (prevStep.get(planId, step - 1) as Row | undefined)?.state;
      if (stepState !== "released") {
        if (stepState === "dropped" || stepState === "invalid") mark.run("dropped", null, `after_${String(stepState)}`, nowMs, planId, step);
        continue;
      }
      before = (previous.get(planId, step - 1) as Row | undefined)?.state as string | undefined;
    }
    if (before === "finished") {
      const actId = randomUUID().replaceAll("-", "");
      insert.run(actId, `${String(row.cycle_id)}:step${step}`, String(row.world), String(row.attachment), String(row.observation_id), String(row.option_ref),
        row.object_id as string | null, row.guid64 as string | null, String(row.label), nowMs, nowMs + DOMUS_ACT_TTL_MS, nowMs);
      mark.run("released", actId, null, nowMs, planId, step);
    } else if (before !== undefined && TERMINAL.has(before)) {
      mark.run("dropped", null, `after_${before}`, nowMs, planId, step);
    }
  }
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
}): { acts: Array<{ act_id: string; object_id: string; guid64: string; expires_at_ms: number }>; applied: number; planned: number } {
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
    dropPlannedSteps(db, { otherThan: input.helperSession, reason: "session_ended", nowMs: input.nowMs });
    releasePlanSteps(db, input.helperSession, input.nowMs);
    const acts = (db.prepare(`SELECT act_id, object_id, guid64, expires_at_ms FROM domus_acts
      WHERE attachment = ? AND state = 'requested' AND expires_at_ms > ? ORDER BY requested_at_ms`).all(input.helperSession, input.nowMs) as Row[])
      .map(row => ({ act_id: String(row.act_id), object_id: String(row.object_id), guid64: String(row.guid64), expires_at_ms: Number(row.expires_at_ms) }));
    // The helper holds back its idle wake while a step still waits to follow.
    const planned = Number((db.prepare("SELECT COUNT(*) AS n FROM domus_plan_steps WHERE attachment = ? AND state = 'planned'")
      .get(input.helperSession) as Row).n);
    db.exec("COMMIT");
    return { acts, applied, planned };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** Her own recent acts in this world, newest last, with the latest thing known about each; then what still waits in her plan (or was let go). */
export function recentDomusActs(db: DatabaseSync, world: string, nowMs: number): DomusRecentAct[] {
  const rows = db.prepare(`SELECT act_id, option_ref, label, state, requested_at_ms, updated_at_ms FROM domus_acts
    WHERE world = ? AND requested_at_ms >= ? ORDER BY requested_at_ms DESC LIMIT ?`).all(world, nowMs - DOMUS_RECENT_ACTS_MS, DOMUS_RECENT_ACTS) as Row[];
  const detail = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = ? ORDER BY at_ms DESC LIMIT 1");
  const steps = db.prepare(`SELECT option_ref, label, state, reason, step, planned_at_ms, updated_at_ms FROM domus_plan_steps
    WHERE plan_id = ? AND state != 'released' ORDER BY step`);
  const acts: DomusRecentAct[] = rows.reverse().map(row => {
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
  const waiting: DomusRecentAct[] = [];
  for (const row of rows) {
    for (const step of steps.all(String(row.act_id)) as Row[]) {
      waiting.push({
        option: String(step.option_ref), label: String(step.label), state: String(step.state),
        requestedAtMs: Number(step.planned_at_ms), updatedAtMs: Number(step.updated_at_ms),
        detail: { planStep: Number(step.step), ...(step.reason ? { reason: String(step.reason) } : {}) },
      });
    }
  }
  return [...acts, ...waiting];
}

export function isDomusActPhase(value: unknown): value is DomusActPhase {
  return typeof value === "string" && PHASES.has(value);
}

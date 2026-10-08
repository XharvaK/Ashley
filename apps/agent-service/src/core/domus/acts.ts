// 8f (direct): Ashley acts in the Sims world. Her Thought names one option the helper listed in the
// pass she read; the Host resolves it from that durable row (no matcher), keeps it as a requested
// act, and the helper pulls it. What happened comes back as append-only events: the helper received
// it, the probe accepted or rejected it, the game ran it and how it finished, or nobody knows.
// A finished act is read as completed or cut short (with why); the stored event keeps the game's
// finishing type.
// H0.5: she may plan up to two more acts after the first (`then`). Each waits until the one before
// completed, or handed over to a game question, and is then requested like any act; a refusal, an
// unknown, or an act cut short ends the plan, a wake (someone arrives, the game asks, a need drops)
// drops the rest, and a new choice replaces it.
// OWNERFIRST: her Thought may mark a choice as one the User asked for (forOwner). The Host never
// infers it. The helper hands it to the probe, which puts it in first; until it completes it
// stays in her view as still open, however many acts came after it.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { endingOf } from "./endings.js";

/** A requested act not picked up by its helper within this time expires; the game never sees it. */
export const DOMUS_ACT_TTL_MS = 90_000;
/** Her own recent acts in the portrait: this many, from this far back. */
export const DOMUS_RECENT_ACTS = 6;
export const DOMUS_RECENT_ACTS_MS = 2 * 60 * 60 * 1000;
/** A plan is the first act and at most this many more. */
export const DOMUS_PLAN_MORE = 2;
/** An act the User asked for that did not complete stays in her view this long. */
export const DOMUS_OWNER_OPEN_MS = 6 * 60 * 60 * 1000;
/** An object the game found no way to (an act there never began) carries that note this long. */
export const DOMUS_NO_WAY_MS = 2 * 60 * 60 * 1000;

/** One answer to a game question: rows she picked (each of the question's own row refs), and words she typed into its fields. */
export type DomusAnswerClaim = { rows?: Array<{ option: string; count?: number }>; text?: Record<string, string> };
export type DomusActClaim = { option: string; then?: string[]; forOwner?: boolean; answer?: DomusAnswerClaim };
export type DomusTextRule = {
  name: string; label: string; min_length: number; max_length: number | null; numeric: boolean;
  min_value: number | null; max_value: number | null; profanity_checked: boolean;
};
/** What a game question accepts (the helper's answer_rules, §11); absent for a window that is not a question she can answer this way. */
export type DomusAnswerRules = {
  select?: { min: number; max: number };
  counts?: { max_in_row: number; max_rows: number };
  text?: DomusTextRule[];
};
export type DomusOptionAct = { ref: string; guid64: string; text: string };
export type DomusOptionObject = {
  object: string; object_id: string; where?: string; acts: DomusOptionAct[]; noWay?: string; answer_rules?: DomusAnswerRules;
};
/** The answer as it is stored and sent to the helper: rows by the game's own option ids, counts resolved, text as she typed it. */
export type DomusStoredAnswer = { rows?: Array<{ option_id: string; count: number }>; text?: Record<string, string> };
export type DomusActBinding = { world: string; attachment: string; observationId: string };
export type DomusActPhase = "received" | "accepted" | "rejected" | "pushed" | "finished" | "unknown" | "expired";
export type DomusActEvent = { actId: string; phase: DomusActPhase; atMs: number; detail?: Record<string, unknown> };
export type DomusRecentAct = {
  option: string; label: string; state: string; requestedAtMs: number; updatedAtMs: number;
  forOwner?: true; stillOpen?: true; detail?: Record<string, unknown>;
};

const PHASES: ReadonlySet<string> = new Set(["received", "accepted", "rejected", "pushed", "finished", "unknown", "expired"]);
/** Terminal states never move again; a late event is still appended (the record keeps what arrived). */
const TERMINAL: ReadonlySet<string> = new Set(["rejected", "finished", "unknown", "expired", "invalid"]);
const RANK: Record<string, number> = { requested: 0, received: 1, accepted: 2, pushed: 3 };

type Row = Record<string, unknown>;

const REF = /^[A-Za-z0-9._-]{1,16}$/;

/** Answer bounds: rows and fields per answer, the count per row, the length of one typed value (characters). */
export const DOMUS_ANSWER_ROWS = 16;
export const DOMUS_ANSWER_COUNT = 99;
export const DOMUS_ANSWER_FIELDS = 8;
export const DOMUS_ANSWER_TEXT = 256;
const FIELD_NAME = /^[A-Za-z0-9_.-]{1,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isDomusActClaim(value: unknown): value is DomusActClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => key === "option" || key === "then" || key === "forOwner" || key === "answer") && typeof record.option === "string"
    && REF.test(record.option) && (record.forOwner === undefined || typeof record.forOwner === "boolean")
    && (record.then === undefined || (Array.isArray(record.then) && record.then.length >= 1 && record.then.length <= DOMUS_PLAN_MORE
      && record.then.every(ref => typeof ref === "string" && REF.test(ref))))
    && (record.answer === undefined || isDomusAnswerClaim(record.answer));
}

/** The shape only: rows or text (or both), rows 1..16 with refs and counts 1..99, text 1..8 named fields of 1..256 characters. */
export function isDomusAnswerClaim(value: unknown): value is DomusAnswerClaim {
  if (!isRecord(value) || !Object.keys(value).every(key => key === "rows" || key === "text")) return false;
  if (value.rows === undefined && value.text === undefined) return false;
  const rowsOk = value.rows === undefined || (Array.isArray(value.rows) && value.rows.length >= 1 && value.rows.length <= DOMUS_ANSWER_ROWS
    && value.rows.every(row => isRecord(row) && Object.keys(row).every(key => key === "option" || key === "count")
      && typeof row.option === "string" && REF.test(row.option)
      && (row.count === undefined || (Number.isInteger(row.count) && (row.count as number) >= 1 && (row.count as number) <= DOMUS_ANSWER_COUNT))));
  const entries = isRecord(value.text) ? Object.entries(value.text) : undefined;
  const textOk = value.text === undefined || (entries !== undefined && entries.length >= 1 && entries.length <= DOMUS_ANSWER_FIELDS
    && entries.every(([name, text]) => FIELD_NAME.test(name) && typeof text === "string"
      && [...text].length >= 1 && [...text].length <= DOMUS_ANSWER_TEXT));
  return rowsOk && textOk;
}

/**
 * The answer rules of one option object, read defensively: a malformed rule set counts as none, so
 * a claim against it is refused rather than checked against guessed bounds.
 */
export function answerRulesOf(object: DomusOptionObject): DomusAnswerRules | undefined {
  const rules = object.answer_rules;
  if (!isRecord(rules)) return undefined;
  const integer = (value: unknown): value is number => Number.isSafeInteger(value);
  const nullableInteger = (value: unknown): value is number | null => value === null || integer(value);
  const out: DomusAnswerRules = {};
  if (rules.select !== undefined) {
    const select = rules.select;
    if (!isRecord(select) || !integer(select.min) || !integer(select.max)) return undefined;
    out.select = { min: select.min, max: select.max };
  }
  if (rules.counts !== undefined) {
    const counts = rules.counts;
    if (!isRecord(counts) || !integer(counts.max_in_row) || !integer(counts.max_rows)) return undefined;
    out.counts = { max_in_row: counts.max_in_row, max_rows: counts.max_rows };
  }
  if (rules.text !== undefined) {
    if (!Array.isArray(rules.text)) return undefined;
    const fields: DomusTextRule[] = [];
    for (const field of rules.text) {
      if (!isRecord(field) || typeof field.name !== "string" || typeof field.label !== "string" || !integer(field.min_length)
        || !nullableInteger(field.max_length) || typeof field.numeric !== "boolean" || !nullableInteger(field.min_value)
        || !nullableInteger(field.max_value) || typeof field.profanity_checked !== "boolean") return undefined;
      fields.push({ name: field.name, label: field.label, min_length: field.min_length, max_length: field.max_length, numeric: field.numeric,
        min_value: field.min_value, max_value: field.max_value, profanity_checked: field.profanity_checked });
    }
    out.text = fields;
  }
  return out;
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
  const answer = found && input.claim.answer !== undefined ? answerFor(found, input.claim.answer) : undefined;
  const refused = answer && "refused" in answer ? answer.refused : null;
  const usable = found !== null && refused === null;
  const actId = randomUUID().replaceAll("-", "");
  // A new choice replaces whatever was still waiting in an earlier plan.
  dropPlannedSteps(db, { world: input.binding.world, reason: "replaced", nowMs: input.nowMs });
  const label = !found ? "" : refused !== null ? `${labelOf(found)} invalid: ${refused}`.slice(0, 200)
    : answer && "stored" in answer ? answer.label : labelOf(found);
  db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id, guid64,
    label, state, requested_at_ms, expires_at_ms, updated_at_ms, for_owner, answer_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    actId, input.cycleId, input.binding.world, input.binding.attachment, input.binding.observationId, input.claim.option,
    found ? found.object.object_id : null, found ? found.act.guid64 : null, label,
    usable ? "requested" : "invalid", input.nowMs, input.nowMs + DOMUS_ACT_TTL_MS, input.nowMs, input.claim.forOwner === true ? 1 : 0,
    answer && "stored" in answer && usable ? answer.json : null);
  const step = db.prepare(`INSERT INTO domus_plan_steps (plan_id, step, world, attachment, option_ref, object_id, guid64, label,
    state, reason, planned_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let broken: string | null = usable ? null : "after_invalid";
  (input.claim.then ?? []).slice(0, DOMUS_PLAN_MORE).forEach((ref, index) => {
    const next = findOption(options, ref);
    const state = broken ? "dropped" : next ? "planned" : "invalid";
    step.run(actId, index + 1, input.binding.world, input.binding.attachment, ref, next ? next.object.object_id : null,
      next ? next.act.guid64 : null, next ? labelOf(next) : "", state, broken, input.nowMs, input.nowMs);
    if (!next && !broken) broken = "after_invalid";
  });
  return { actId, state: usable ? "requested" : "invalid" };
}

function labelOf(found: { object: DomusOptionObject; act: DomusOptionAct }): string {
  return `${found.act.text} (${found.object.object})`.slice(0, 200);
}

/**
 * Her answer to a game question, checked against the rules the question carried in the pass she
 * read. Anything wrong is refused with a short reason; nothing is trimmed, guessed or substituted.
 * A stored answer keeps the game's row ids and her words; its label says what she answered, with
 * only the field names and lengths of her typed words (never the words themselves).
 */
function answerFor(found: { object: DomusOptionObject; act: DomusOptionAct }, answer: DomusAnswerClaim):
  { stored: true; json: string; label: string } | { refused: string } {
  if (!found.object.object_id.startsWith("dialog:")) return { refused: "answer:not_a_dialog" };
  const rules = answerRulesOf(found.object);
  if (!rules) return { refused: "answer:no_rules" };
  if (found.act.guid64 !== "ok") return { refused: "answer:not_ok" };
  const rows = answer.rows ?? [];
  if (rows.length || rules.select) {
    const select = rules.select ?? { min: 1, max: rules.counts?.max_rows ?? 1 };
    if (rows.length < select.min) return { refused: "answer:too_few_rows" };
    if (rows.length > select.max) return { refused: "answer:too_many_rows" };
    if (rules.counts && rows.length > rules.counts.max_rows) return { refused: "answer:too_many_rows" };
  }
  const picked = new Set<string>();
  const resolved: Array<{ option_id: string; count: number }> = [];
  const parts: string[] = [];
  for (const row of rows) {
    const target = found.object.acts.find(item => item && typeof item === "object" && item.ref === row.option);
    if (!target || typeof target.guid64 !== "string" || typeof target.text !== "string") return { refused: "answer:row_not_in_dialog" };
    if (!/^[0-9]+$/.test(target.guid64)) return { refused: "answer:not_a_row" };
    if (picked.has(target.ref)) return { refused: "answer:row_repeated" };
    picked.add(target.ref);
    if (row.count !== undefined) {
      if (!rules.counts) return { refused: "answer:count_not_allowed" };
      if (row.count > rules.counts.max_in_row) return { refused: "answer:count_too_high" };
    }
    const count = row.count ?? 1;
    resolved.push({ option_id: target.guid64, count });
    parts.push(count > 1 ? `${target.text} x${count}` : target.text);
  }
  const typed = answer.text ?? {};
  const fields = rules.text ?? [];
  for (const [name, value] of Object.entries(typed)) {
    const field = fields.find(item => item.name === name);
    if (!field) return { refused: `answer:unknown_field:${name}` };
    const problem = textProblem(field, value);
    if (problem) return { refused: `answer:${problem}:${name}` };
    parts.push(`${name} ${[...value].length} chars`);
  }
  for (const field of fields) {
    if (field.min_length > 0 && !Object.prototype.hasOwnProperty.call(typed, field.name)) return { refused: `answer:text_missing:${field.name}` };
  }
  const stored: DomusStoredAnswer = {
    ...(resolved.length ? { rows: resolved } : {}),
    ...(Object.keys(typed).length ? { text: { ...typed } } : {}),
  };
  return { stored: true, json: JSON.stringify(stored), label: `answered ${found.object.object}: ${parts.join(", ")}`.slice(0, 200) };
}

/** One typed value against its field's rules: the first problem found, as a short reason. */
function textProblem(field: DomusTextRule, value: string): string | null {
  if (/\p{Cc}/u.test(value)) return "text_control";
  if (field.max_length === null) return "text_no_limit";
  const length = [...value].length;
  if (length > field.max_length) return "text_too_long";
  if (length < field.min_length) return "text_too_short";
  if (!field.numeric) return null;
  if (!/^-?[0-9]{1,15}$/.test(value)) return "text_not_integer";
  if (field.min_value === null || field.max_value === null) return "text_no_range";
  const amount = Number(value);
  return amount < field.min_value || amount > field.max_value ? "text_out_of_range" : null;
}

/** Steps still waiting are let go (a new choice, a wake, a session that ended); released ones run their course. */
function dropPlannedSteps(db: DatabaseSync, input: { world?: string; attachment?: string; otherThan?: string; reason: string; nowMs: number }): number {
  const where = input.world !== undefined ? "world = ?" : input.attachment !== undefined ? "attachment = ?" : "attachment != ?";
  const value = input.world ?? input.attachment ?? input.otherThan ?? "";
  return Number(db.prepare(`UPDATE domus_plan_steps SET state = 'dropped', reason = ?, updated_at_ms = ?
    WHERE state = 'planned' AND ${where}`).run(input.reason, input.nowMs, value).changes ?? 0);
}

/**
 * Percepts that wake her for something new end a plan: someone arriving, the game asking, a need
 * dropping a band, a refused act, a new place. Not her own act ending (idle), a slow check, or a
 * mood change (most often what her own act did to her).
 */
const NOT_INTERRUPTING: ReadonlySet<string> = new Set(["idle", "check"]);

export function isInterruptingPercept(percept: unknown): boolean {
  const kind = (percept as { kind?: unknown } | null)?.kind;
  const facts = (percept as { facts?: Record<string, unknown> } | null)?.facts;
  if (!facts || typeof facts !== "object" || kind === "moodlet") return false;
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

/** Release the next step when the previous act completed, or handed the game a question; an act cut short ends the plan. */
function releasePlanSteps(db: DatabaseSync, helperSession: string, nowMs: number): void {
  const steps = db.prepare(`SELECT s.plan_id, s.step, s.option_ref, s.object_id, s.guid64, s.label, a.cycle_id, a.world,
    a.attachment, a.observation_id, a.for_owner FROM domus_plan_steps s JOIN domus_acts a ON a.act_id = s.plan_id
    WHERE s.attachment = ? AND s.state = 'planned' ORDER BY s.plan_id, s.step`).all(helperSession) as Row[];
  const previous = db.prepare(`SELECT a.act_id, a.state FROM domus_plan_steps s JOIN domus_acts a ON a.act_id = s.act_id
    WHERE s.plan_id = ? AND s.step = ?`);
  const head = db.prepare("SELECT act_id, state FROM domus_acts WHERE act_id = ?");
  const prevStep = db.prepare("SELECT state FROM domus_plan_steps WHERE plan_id = ? AND step = ?");
  const finished = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = 'finished' ORDER BY at_ms DESC LIMIT 1");
  const insert = db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id,
    guid64, label, state, requested_at_ms, expires_at_ms, updated_at_ms, for_owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?)`);
  const mark = db.prepare("UPDATE domus_plan_steps SET state = ?, act_id = ?, reason = ?, updated_at_ms = ? WHERE plan_id = ? AND step = ?");
  const cutShort = new Set<string>();
  const endingOfFinished = (actId: string | undefined) => {
    if (!actId) return endingOf(undefined);
    const row = finished.get(actId) as Row | undefined;
    if (!row) return endingOf(undefined);
    try {
      const parsed = JSON.parse(String(row.detail_json)) as { finishing_type?: unknown; started?: unknown };
      const plain = parsed && typeof parsed === "object" && !Array.isArray(parsed);
      return endingOf(plain ? parsed.finishing_type : undefined, plain ? parsed.started : undefined);
    } catch { return endingOf(undefined); }
  };
  for (const row of steps) {
    const planId = String(row.plan_id);
    const step = Number(row.step);
    if (cutShort.has(planId)) {
      mark.run("dropped", null, "after_cut_short", nowMs, planId, step);
      continue;
    }
    let before: string | undefined;
    let beforeId: string | undefined;
    if (step === 1) {
      const ran = head.get(planId) as Row | undefined;
      before = ran?.state as string | undefined;
      beforeId = ran ? String(ran.act_id) : undefined;
    } else {
      const stepState = (prevStep.get(planId, step - 1) as Row | undefined)?.state;
      if (stepState !== "released") {
        if (stepState === "dropped" || stepState === "invalid") mark.run("dropped", null, `after_${String(stepState)}`, nowMs, planId, step);
        continue;
      }
      const ran = previous.get(planId, step - 1) as Row | undefined;
      before = ran?.state as string | undefined;
      beforeId = ran?.act_id ? String(ran.act_id) : undefined;
    }
    if (before === "finished") {
      const ending = endingOfFinished(beforeId);
      if (ending.ended === "completed" || ending.ended === "asked" || ending.ended === "answered") {
        const actId = randomUUID().replaceAll("-", "");
        insert.run(actId, `${String(row.cycle_id)}:step${step}`, String(row.world), String(row.attachment), String(row.observation_id), String(row.option_ref),
          row.object_id as string | null, row.guid64 as string | null, String(row.label), nowMs, nowMs + DOMUS_ACT_TTL_MS, nowMs,
          Number(row.for_owner) === 1 ? 1 : 0);
        mark.run("released", actId, null, nowMs, planId, step);
      } else {
        cutShort.add(planId);
        mark.run("dropped", null, "after_cut_short", nowMs, planId, step);
      }
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
}): { acts: Array<{ act_id: string; object_id: string; guid64: string; expires_at_ms: number; owner?: true; answer?: DomusStoredAnswer }>; applied: number; planned: number } {
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
    const acts = (db.prepare(`SELECT act_id, object_id, guid64, expires_at_ms, for_owner, answer_json FROM domus_acts
      WHERE attachment = ? AND state = 'requested' AND expires_at_ms > ? ORDER BY requested_at_ms`).all(input.helperSession, input.nowMs) as Row[])
      .map(row => ({ act_id: String(row.act_id), object_id: String(row.object_id), guid64: String(row.guid64), expires_at_ms: Number(row.expires_at_ms),
        ...(Number(row.for_owner) === 1 ? { owner: true as const } : {}), ...storedAnswerOf(row.answer_json) }));
    // The helper holds back its idle wake while a step still waits to follow.
    const planned = Number((db.prepare("SELECT COUNT(*) AS n FROM domus_plan_steps WHERE attachment = ? AND state = 'planned'")
      .get(input.helperSession) as Row).n);
    db.exec("COMMIT");
    return { acts, applied, planned };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

/** The stored answer of an act, as the helper gets it (absent when there is none or it cannot be read). */
function storedAnswerOf(json: unknown): { answer?: DomusStoredAnswer } {
  if (json === null || json === undefined) return {};
  try {
    const parsed = JSON.parse(String(json)) as unknown;
    return isRecord(parsed) ? { answer: parsed as DomusStoredAnswer } : {};
  } catch { return {}; }
}

/** Her own recent acts in this world, newest last, with the latest thing known about each; then what still waits in her plan (or was let go). OWNERFIRST: an act the User asked for that did not complete is kept at the front, still open, until a later act on the same thing completes or DOMUS_OWNER_OPEN_MS passes. */
export function recentDomusActs(db: DatabaseSync, world: string, nowMs: number): DomusRecentAct[] {
  const rows = db.prepare(`SELECT act_id, option_ref, label, state, requested_at_ms, updated_at_ms, for_owner FROM domus_acts
    WHERE world = ? AND requested_at_ms >= ? ORDER BY requested_at_ms DESC LIMIT ?`).all(world, nowMs - DOMUS_RECENT_ACTS_MS, DOMUS_RECENT_ACTS) as Row[];
  const detail = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = ? ORDER BY at_ms DESC LIMIT 1");
  const steps = db.prepare(`SELECT option_ref, label, state, reason, step, planned_at_ms, updated_at_ms FROM domus_plan_steps
    WHERE plan_id = ? AND state != 'released' ORDER BY step`);
  const shown = (row: Row, open: boolean): DomusRecentAct => {
    let extra: Record<string, unknown> | undefined;
    try {
      const found = detail.get(String(row.act_id), String(row.state)) as Row | undefined;
      const parsed = found ? JSON.parse(String(found.detail_json)) as Record<string, unknown> : {};
      if (Object.keys(parsed).length) extra = parsed;
    } catch { /* no detail */ }
    if (String(row.state) === "finished") {
      const rest = { ...(extra ?? {}) };
      const finishingType = rest.finishing_type;
      const started = rest.started;
      delete rest.finishing_type;
      delete rest.started;
      const ending = endingOf(finishingType, started);
      extra = { ...rest, ended: ending.ended, ...(ending.why ? { why: ending.why } : {}) };
    }
    return {
      option: String(row.option_ref), label: String(row.label), state: String(row.state),
      requestedAtMs: Number(row.requested_at_ms), updatedAtMs: Number(row.updated_at_ms),
      ...(Number(row.for_owner) === 1 ? { forOwner: true as const } : {}), ...(open ? { stillOpen: true as const } : {}),
      ...(extra ? { detail: extra } : {}),
    };
  };
  const recent = new Set(rows.map(row => String(row.act_id)));
  const opened = openOwnerActs(db, world, nowMs);
  const acts: DomusRecentAct[] = [
    ...opened.filter(row => !recent.has(String(row.act_id))).map(row => shown(row, true)),
    ...rows.reverse().map(row => shown(row, opened.some(open => String(open.act_id) === String(row.act_id)))),
  ];
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

/** Whether an act reached its end as done: completed, or handed over to a game question it opened or answered. */
function actDone(db: DatabaseSync, actId: string, state: string): boolean {
  if (state !== "finished") return false;
  const row = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = 'finished' ORDER BY at_ms DESC LIMIT 1")
    .get(actId) as Row | undefined;
  let parsed: Record<string, unknown> = {};
  try { parsed = row ? JSON.parse(String(row.detail_json)) as Record<string, unknown> : {}; } catch { /* unreadable is not done */ }
  return endingOf(parsed.finishing_type, parsed.started).ended !== "cut_short";
}

/** OWNERFIRST: acts the User asked for, oldest first, that ended without being done and that no later act on the same thing has since done. */
function openOwnerActs(db: DatabaseSync, world: string, nowMs: number): Row[] {
  const asked = db.prepare(`SELECT act_id, option_ref, label, state, requested_at_ms, updated_at_ms, for_owner, object_id, guid64 FROM domus_acts
    WHERE world = ? AND for_owner = 1 AND requested_at_ms >= ? ORDER BY requested_at_ms`).all(world, nowMs - DOMUS_OWNER_OPEN_MS) as Row[];
  const later = db.prepare(`SELECT act_id, state FROM domus_acts WHERE world = ? AND object_id = ? AND guid64 = ? AND requested_at_ms > ?`);
  return asked.filter(row => {
    const state = String(row.state);
    if (!TERMINAL.has(state) || actDone(db, String(row.act_id), state)) return false;
    if (row.object_id === null || row.guid64 === null) return true;
    return !(later.all(world, String(row.object_id), String(row.guid64), Number(row.requested_at_ms)) as Row[])
      .some(next => actDone(db, String(next.act_id), String(next.state)));
  });
}

/** Objects where an act of hers ended before it ever began because the game found no way there, newest note per object. */
export function domusNoWayObjects(db: DatabaseSync, world: string, nowMs: number): Map<string, string> {
  const rows = db.prepare(`SELECT a.object_id, e.detail_json FROM domus_act_events e JOIN domus_acts a ON a.act_id = e.act_id
    WHERE a.world = ? AND e.phase = 'finished' AND e.at_ms >= ? AND a.object_id IS NOT NULL ORDER BY e.at_ms`)
    .all(world, nowMs - DOMUS_NO_WAY_MS) as Row[];
  const found = new Map<string, string>();
  for (const row of rows) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(String(row.detail_json)) as Record<string, unknown>; } catch { continue; }
    const ending = endingOf(parsed.finishing_type, parsed.started);
    if (parsed.started === false && ending.ended === "cut_short" && ending.why) found.set(String(row.object_id), ending.why);
    else found.delete(String(row.object_id));
  }
  return found;
}

export function isDomusActPhase(value: unknown): value is DomusActPhase {
  return typeof value === "string" && PHASES.has(value);
}

// H0.4 (live 2026-10-05: a pass every ~25 s wrote the same journal line while only walk-bys passed
// the house): what changed in her game life since the pass she last settled, as Host facts. Thought
// is stateless, so the whole portrait still comes with every pass; these facts sit beside it and
// leave nothing out. Nothing is judged: a need's band, her mood, posture, room, feelings, what her
// body runs, who is on the lot, what the game asks, what she can do and what became of her acts are
// compared as they are, and any other portrait part counts when its value differs. The clock and its
// speed, need values and people passing off the lot are not compared. A pass where none of it
// changed is quiet.
import type { DatabaseSync } from "node:sqlite";
import { optionsOf, type DomusOptionObject } from "./acts.js";

export type DomusSetChange = { gained?: string[]; lost?: string[] };
export type DomusChanges = {
  /** Game time of the newest observation in the pass she last settled; absent on a first pass. */
  sinceMs?: number;
  /** No settled pass earlier in this game session: all of it is new to her. */
  first?: true;
  /** Nothing compared changed since her last pass. */
  quiet?: true;
  /** need: "band before → band now". */
  needs?: Record<string, string>;
  mood?: string;
  posture?: string;
  room?: string;
  feelings?: DomusSetChange;
  doing?: DomusSetChange;
  /** People on the lot. */
  people?: DomusSetChange;
  asked?: DomusSetChange;
  /** Things she can act on (by object). */
  options?: DomusSetChange;
  /** How many reports about her acts arrived since her last pass. */
  actNews?: number;
  /** Other portrait parts that differ, and senses of a kind the comparison above does not cover. */
  other?: string[];
  /** What was compared and is as it was. */
  unchanged?: string[];
};

/** Percept kinds whose substance the portrait comparison already covers. */
const COVERED_PERCEPTS: ReadonlySet<string> = new Set(["presence", "need", "interaction", "posture", "env"]);
/** Portrait parts compared on their own terms below, or not compared at all: the clock, its speed and
 * pause (the controls, not her life), and whether more people are about than company lists (live
 * 2026-10-05: it flips with every walk-by). */
const OWN_TERMS: ReadonlySet<string> = new Set(["needs", "mood", "posture", "zone", "moodlets", "running", "company", "asked",
  "time", "clock_speed", "paused", "more_nearby"]);
const SET_LIMIT = 6;

type Row = Record<string, unknown>;
type Read = { portrait: Row; options: DomusOptionObject[] };

function record(value: unknown): Row | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = record(value);
  if (object) return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function labels(value: unknown, key: string | null, fallback?: string): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const object = record(item);
    const label = key === null ? scalar(item) : object ? scalar(object[key]) ?? (fallback ? scalar(object[fallback]) : undefined) : undefined;
    if (label) result.add(label.slice(0, 120));
  }
  return result;
}

function people(value: unknown): Set<string> {
  const result = new Set<string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const person = record(item);
    if (person?.on_lot !== true) continue;
    // SS4-v2: a Sim she only hears has no name or id, just the helper's keyed handle; a short tag of it keeps
    // two strangers apart, so one leaving while another comes is a change.
    const handle = person.heard === true ? scalar(person.handle) : undefined;
    const label = handle !== undefined ? `someone heard (#${String(handle).slice(0, 4)})` : String(scalar(person.name) ?? scalar(person.id) ?? "someone");
    result.add(label.slice(0, 120));
  }
  return result;
}

function bands(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  for (const [need, state] of Object.entries(record(value) ?? {})) {
    const band = scalar(record(state)?.band);
    if (band) result.set(need, band);
  }
  return result;
}

function optionKeys(options: readonly DomusOptionObject[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const object of options) {
    for (const act of object.acts ?? []) {
      if (act && typeof act.guid64 === "string") result.set(`${object.object_id}:${act.guid64}`, String(object.object).slice(0, 120));
    }
  }
  return result;
}

function setChange(before: Set<string>, now: Set<string>): DomusSetChange | undefined {
  const gained = [...now].filter(item => !before.has(item)).slice(0, SET_LIMIT);
  const lost = [...before].filter(item => !now.has(item)).slice(0, SET_LIMIT);
  if (!gained.length && !lost.length) return undefined;
  return { ...(gained.length ? { gained } : {}), ...(lost.length ? { lost } : {}) };
}

/** An object with an action she did not have before is gained; one that lost actions only is lost. */
function optionsChange(before: readonly DomusOptionObject[], now: readonly DomusOptionObject[]): DomusSetChange | undefined {
  const was = optionKeys(before);
  const is = optionKeys(now);
  const gained = [...new Set([...is].filter(([key]) => !was.has(key)).map(([, object]) => object))];
  const lost = [...new Set([...was].filter(([key]) => !is.has(key)).map(([, object]) => object))].filter(object => !gained.includes(object));
  if (!gained.length && !lost.length) return undefined;
  return { ...(gained.length ? { gained: gained.slice(0, SET_LIMIT) } : {}), ...(lost.length ? { lost: lost.slice(0, SET_LIMIT) } : {}) };
}

function arrow(before: string | undefined, now: string | undefined): string | undefined {
  return before === now ? undefined : `${before ?? "none"} → ${now ?? "none"}`;
}

/** The pure comparison of what she last read with what she reads now. */
export function compareDomusReads(before: Read, now: Read, input: { actNews: number; perceptKinds: readonly string[]; urgent: boolean }): DomusChanges {
  const changes: DomusChanges = {};
  const unchanged: string[] = [];
  const was = before.portrait;
  const is = now.portrait;
  const needBands = { before: bands(was.needs), now: bands(is.needs) };
  const needs: Record<string, string> = {};
  for (const need of new Set([...needBands.before.keys(), ...needBands.now.keys()])) {
    const moved = arrow(needBands.before.get(need), needBands.now.get(need));
    if (moved) needs[need] = moved;
  }
  if (Object.keys(needs).length) changes.needs = needs; else if (needBands.now.size) unchanged.push("needs");
  const scalars: Array<["mood" | "posture" | "room", unknown, unknown]> = [
    ["mood", was.mood, is.mood], ["posture", was.posture, is.posture], ["room", record(was.zone)?.room, record(is.zone)?.room],
  ];
  for (const [name, then, current] of scalars) {
    const moved = arrow(scalar(then), scalar(current));
    if (moved) changes[name] = moved; else if (scalar(current) !== undefined) unchanged.push(name);
  }
  const sets: Array<["feelings" | "doing" | "people" | "asked", Set<string>, Set<string>]> = [
    ["feelings", labels(was.moodlets, "text", "name"), labels(is.moodlets, "text", "name")],
    ["doing", labels(was.running, null), labels(is.running, null)],
    ["people", people(was.company), people(is.company)],
    ["asked", labels(was.asked, "title"), labels(is.asked, "title")],
  ];
  for (const [name, then, current] of sets) {
    const moved = setChange(then, current);
    if (moved) changes[name] = moved; else unchanged.push(name);
  }
  if (before.options.length || now.options.length) {
    const moved = optionsChange(before.options, now.options);
    if (moved) changes.options = moved; else unchanged.push("options");
  }
  if (input.actNews > 0) changes.actNews = input.actNews; else unchanged.push("acts");
  const other: string[] = [];
  for (const key of [...new Set([...Object.keys(was), ...Object.keys(is)])].sort()) {
    if (OWN_TERMS.has(key)) continue;
    if (canonical(was[key]) !== canonical(is[key])) other.push(key);
  }
  if (canonical(record(was.zone)?.lot_id) !== canonical(record(is.zone)?.lot_id)) other.push("lot");
  for (const kind of [...new Set(input.perceptKinds)].sort()) if (!COVERED_PERCEPTS.has(kind)) other.push(`sense:${kind}`);
  if (input.urgent) other.push("urgent");
  if (other.length) changes.other = other;
  if (!Object.keys(changes).length) changes.quiet = true;
  if (unchanged.length) changes.unchanged = unchanged;
  return changes;
}

/**
 * The pass she last settled in this game session (helper attachment), before this one: the newest
 * observation it read and when it was admitted. A pass that never settled was never read.
 */
export function previousDomusRead(db: DatabaseSync, input: {
  conversationId: string; eventId: string; attachment: string; createdAtMs: number;
}): { observationIds: string[]; world: string; createdAtMs: number } | undefined {
  const rows = db.prepare(`SELECT id, payload_json, created_at_ms FROM inbox_events
    WHERE conversation_id = ? AND kind = 'domus_notification' AND id != ? AND created_at_ms <= ?
      AND json_extract(payload_json, '$.domus.attachment') = ?
      AND EXISTS (SELECT 1 FROM settlements s WHERE s.cycle_id = json_extract(inbox_events.payload_json, '$.cycleId'))
    ORDER BY created_at_ms DESC, id DESC LIMIT 1`).all(input.conversationId, input.eventId, input.createdAtMs, input.attachment) as Row[];
  const row = rows[0];
  if (!row) return undefined;
  try {
    const domus = record(record(JSON.parse(String(row.payload_json)))?.domus);
    if (!domus || typeof domus.world !== "string" || !Array.isArray(domus.observationIds)) return undefined;
    return { observationIds: domus.observationIds.map(String), world: domus.world, createdAtMs: Number(row.created_at_ms) };
  } catch { return undefined; }
}

/** The newest portrait and options among a pass's rows, as stored (undone rows count as unread). */
export function domusReadOf(db: DatabaseSync, world: string, observationIds: readonly string[]): (Read & { sourceTimeMs: number }) | undefined {
  const read = db.prepare(`SELECT world, source_time_ms, payload_json FROM domus_observations
    WHERE observation_id = ? AND admission_state = 'admitted' AND undone_at_ms IS NULL`);
  const rows = observationIds.map(id => read.get(String(id)) as Row | undefined)
    .filter((row): row is Row => row !== undefined && row.world === world);
  if (!rows.length) return undefined;
  let portrait: Row | undefined;
  let options: DomusOptionObject[] = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!portrait) {
      try { portrait = record((JSON.parse(String(rows[index]!.payload_json)) as Row).portrait); } catch { /* none here */ }
    }
    if (!options.length) options = optionsOf(rows[index]!.payload_json);
  }
  return { portrait: portrait ?? {}, options, sourceTimeMs: Math.max(...rows.map(row => Number(row.source_time_ms))) };
}

/** Reports about her acts in this world that arrived after one time, up to another. */
export function domusActNewsSince(db: DatabaseSync, world: string, sinceMs: number, untilMs: number): number {
  const row = db.prepare(`SELECT count(*) AS n FROM domus_act_events e JOIN domus_acts a ON a.act_id = e.act_id
    WHERE a.world = ? AND e.received_at_ms > ? AND e.received_at_ms <= ?`).get(world, sinceMs, untilMs) as Row | undefined;
  return Number(row?.n ?? 0);
}

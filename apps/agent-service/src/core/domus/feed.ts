// E3: the overlay feed. The helper pulls her settled game passes for its own session, newest last,
// each with the act she chose, the rest of her plan and what became of them. Only passes stamped
// game-only at admission are listed: a pass that could have read the Owner's conversations is never
// in the feed, whatever it wrote. A line the Host cannot show (not ordinary, or naming someone she
// knows from Discord, a handle, an id or a link) is held: the pass is listed, its words are not.
import type { DatabaseSync } from "node:sqlite";
import { DOMUS_GAME_ONLY } from "./lane.js";

/** The feed lists this many passes, from this far back. */
export const DOMUS_FEED_LIMIT = 12;
export const DOMUS_FEED_WINDOW_MS = 2 * 60 * 60 * 1000;

export type DomusFeedStep = { label: string; state: string; reason?: string };
export type DomusFeedAct = { label: string; state: string; how?: string };
export type DomusFeedItem = {
  pass: string;
  at_ms: number;
  inputs: typeof DOMUS_GAME_ONLY;
  line?: string;
  held?: true;
  quiet?: true;
  act?: DomusFeedAct;
  plan?: DomusFeedStep[];
};

type Row = Record<string, unknown>;

/** Mechanical shapes that never reach the overlay: Discord mentions and handles, long ids, links. */
const NEVER_SHOWN = [/<[@#][!&]?\d+>/, /(^|[^\w])@[A-Za-z0-9_.]{2,}/, /\d{15,}/, /https?:\/\//i, /discord(app)?\.(com|gg)/i];
const NAME_MIN = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Names the Host knows from Discord (people, servers, rooms), as whole-word patterns. */
function knownNames(db: DatabaseSync): RegExp[] {
  const rows = db.prepare("SELECT DISTINCT name FROM discord_names").all() as Row[];
  return rows.map(row => String(row.name ?? "").trim()).filter(name => name.length >= NAME_MIN)
    .map(name => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "iu"));
}

export function heldLine(line: string, names: readonly RegExp[]): boolean {
  return NEVER_SHOWN.some(pattern => pattern.test(line)) || names.some(pattern => pattern.test(line));
}

function detailOf(json: unknown): Row {
  try {
    const parsed = JSON.parse(String(json ?? "{}")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Row : {};
  } catch { return {}; }
}

/** How an act ended or why it did not run, in the game's own words where it gave some. */
function howOf(state: string, detail: Row): string | undefined {
  for (const key of state === "finished" ? ["finishing_type"] : ["code", "detail"]) {
    const value = detail[key];
    if (typeof value === "string" && value) return value.slice(0, 80);
  }
  return undefined;
}

export function domusFeed(db: DatabaseSync, input: { helperSession: string; nowMs: number }): DomusFeedItem[] {
  const rows = db.prepare(`SELECT j.entry_id, j.cycle_id, j.entry, j.data_classification, j.created_at_ms
      FROM inbox_events e JOIN activity_journal j ON j.cycle_id = json_extract(e.payload_json, '$.cycleId')
     WHERE e.kind = 'domus_notification' AND e.created_at_ms >= ? AND json_valid(e.payload_json)
       AND json_extract(e.payload_json, '$.domus.attachment') = ? AND json_extract(e.payload_json, '$.inputs') = ?
       AND j.forgotten_at_ms IS NULL AND j.lineage_class = 'current'
     ORDER BY j.created_at_ms DESC, j.entry_id DESC LIMIT ?`)
    .all(input.nowMs - DOMUS_FEED_WINDOW_MS, input.helperSession, DOMUS_GAME_ONLY, DOMUS_FEED_LIMIT) as Row[];
  if (rows.length === 0) return [];
  const names = knownNames(db);
  const shown = (label: string): string => heldLine(label, names) ? "…" : label;
  const actOf = db.prepare("SELECT act_id, label, state FROM domus_acts WHERE cycle_id = ?");
  const eventOf = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = ? ORDER BY at_ms DESC LIMIT 1");
  const stepsOf = db.prepare("SELECT step, label, state, reason, act_id FROM domus_plan_steps WHERE plan_id = ? ORDER BY step");
  const stepAct = db.prepare("SELECT label, state FROM domus_acts WHERE act_id = ?");
  return rows.reverse().map((row): DomusFeedItem => {
    const item: DomusFeedItem = { pass: String(row.entry_id), at_ms: Number(row.created_at_ms), inputs: DOMUS_GAME_ONLY };
    const line = typeof row.entry === "string" ? row.entry.trim() : "";
    if (!line) item.quiet = true;
    else if (row.data_classification !== "ordinary" || heldLine(line, names)) item.held = true;
    else item.line = line;
    const act = actOf.get(String(row.cycle_id)) as Row | undefined;
    if (act) {
      const state = String(act.state);
      const how = howOf(state, detailOf((eventOf.get(String(act.act_id), state) as Row | undefined)?.detail_json));
      item.act = { label: shown(String(act.label)), state, ...(how ? { how } : {}) };
      const plan = (stepsOf.all(String(act.act_id)) as Row[]).map((step): DomusFeedStep => {
        // A released step became an act of its own; what became of that act is the step's news.
        const ran = step.state === "released" && step.act_id ? stepAct.get(String(step.act_id)) as Row | undefined : undefined;
        return { label: shown(String(step.label)), state: ran ? String(ran.state) : String(step.state),
          ...(step.reason ? { reason: String(step.reason) } : {}) };
      });
      if (plan.length) item.plan = plan;
    }
    return item;
  });
}

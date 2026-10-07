import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_OWNER_TIME_ZONE } from "../thought/clock.js";
import { isUnsolicitedTriggerKind } from "../initiative/reach-out.js";

/**
 * The Owner's quiet window. The Host records it and enforces the cap.
 * Thought owns what a held note means. Since Wave 2 her settlement may open
 * one (quiet: the Owner's word, or her own), bounded the same way.
 */

export const QUIET_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const QUIET_MAX_MS = 12 * 60 * 60 * 1000;
export const QUIET_SILENT_CAP = 2;
export const QUIET_HELD_CAP = 10;
export const QUIET_HELD_PREVIEW = 3;
export const QUIET_HELD_TEXT_CHARS = 300;
const QUIET_STORED_TEXT_CHARS = 8_000;

export type QuietSource = "owner_command" | "owner_dnd" | "her_own";

export type QuietWindow = {
  source: QuietSource;
  untilMs: number;
  openedAtMs: number;
  silentNotesSent: number;
};

export type HeldWhileQuiet = {
  count: number;
  items: string[];
  droppedCount: number;
};

export type QuietRefusalFact = { code: "quiet_held"; atMs: number };
export type OwnerPresenceFact = { status: "online" | "idle"; sinceMs: number };

export type QuietPassFacts = {
  quietRefusal?: QuietRefusalFact;
  heldWhileQuiet?: HeldWhileQuiet;
  ownerPresence?: OwnerPresenceFact;
};

export type QuietPublication =
  | { kind: "allow" }
  | { kind: "silent" }
  | { kind: "hold"; text: string };

const OPTIONAL_INITIATIVE = new Set(["idle_opportunity", "subscription_item", "future_trigger_due"]);

type Row = Record<string, unknown>;

function zoneOrDefault(timeZone: string | undefined): string {
  const candidate = timeZone?.trim() || DEFAULT_OWNER_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_OWNER_TIME_ZONE;
  }
}

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function offsetAt(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

function civilToUtc(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const offset = offsetAt(guess, timeZone);
  const utc = guess - offset;
  const again = offsetAt(utc, timeZone);
  return again === offset ? utc : guess - again;
}

function nextCivilDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** The next local 08:00 strictly after now. A window never runs past it. */
export function nextLocalEightMs(nowMs: number, timeZone?: string): number {
  const zone = zoneOrDefault(timeZone);
  const local = zonedParts(nowMs, zone);
  const today = civilToUtc(local.year, local.month, local.day, 8, zone);
  if (today > nowMs) return today;
  const next = nextCivilDay(local.year, local.month, local.day);
  return civilToUtc(next.year, next.month, next.day, 8, zone);
}

export function quietUntilMs(nowMs: number, durationMs: number | undefined, timeZone?: string): number {
  const requested = durationMs === undefined ? QUIET_DEFAULT_MS : durationMs;
  if (!Number.isSafeInteger(requested) || requested <= 0 || requested > QUIET_MAX_MS) {
    throw new Error("quiet_duration_invalid");
  }
  return Math.min(nowMs + requested, nextLocalEightMs(nowMs, timeZone));
}

function mapWindow(row: Row | undefined): QuietWindow | null {
  if (!row) return null;
  const source = row.source;
  if (source !== "owner_command" && source !== "owner_dnd" && source !== "her_own") return null;
  return {
    source,
    untilMs: Number(row.until_ms),
    openedAtMs: Number(row.opened_at_ms),
    silentNotesSent: Number(row.silent_notes_sent),
  };
}

function readRow(db: DatabaseSync): QuietWindow | null {
  return mapWindow(db.prepare("SELECT source, until_ms, opened_at_ms, silent_notes_sent FROM quiet_windows WHERE id = 1").get() as Row | undefined);
}

export function readOpenQuietWindow(db: DatabaseSync, nowMs: number): QuietWindow | null {
  const row = readRow(db);
  if (!row || row.untilMs <= nowMs) return null;
  return row;
}

function writeWindow(db: DatabaseSync, source: QuietSource, untilMs: number, openedAtMs: number): QuietWindow {
  db.prepare(
    `INSERT INTO quiet_windows (id, source, until_ms, opened_at_ms, silent_notes_sent)
     VALUES (1, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       source = excluded.source,
       until_ms = excluded.until_ms,
       opened_at_ms = excluded.opened_at_ms,
       silent_notes_sent = 0`,
  ).run(source, untilMs, openedAtMs);
  const written = readOpenQuietWindow(db, openedAtMs);
  if (!written) throw new Error("quiet_window_not_written");
  return written;
}

/** UX W2: a window opened from her settlement (the Owner's word, or her own), bounded like every other. */
export function writeQuietWindow(db: DatabaseSync, source: QuietSource, untilMs: number, openedAtMs: number): QuietWindow {
  return writeWindow(db, source, untilMs, openedAtMs);
}

export function openOwnerQuiet(
  db: DatabaseSync,
  input: { nowMs: number; durationMs?: number; timeZone?: string },
): QuietWindow {
  const untilMs = quietUntilMs(input.nowMs, input.durationMs, input.timeZone);
  return writeWindow(db, "owner_command", untilMs, input.nowMs);
}

/**
 * DND opens a window only when none is open. An open window is left alone,
 * so a repeated DND update cannot extend it. Closing removes only a
 * DND-sourced window.
 */
export function setOwnerDnd(
  db: DatabaseSync,
  on: boolean,
  nowMs: number,
  timeZone?: string,
): QuietWindow | null {
  const open = readOpenQuietWindow(db, nowMs);
  if (on) {
    if (open) return open;
    return writeWindow(db, "owner_dnd", quietUntilMs(nowMs, undefined, timeZone), nowMs);
  }
  if (open?.source === "owner_dnd") {
    db.prepare("DELETE FROM quiet_windows WHERE id = 1 AND source = 'owner_dnd'").run();
    return null;
  }
  return open;
}

export function endQuietWindow(db: DatabaseSync): void {
  db.prepare("DELETE FROM quiet_windows WHERE id = 1").run();
}

/** Any admitted Owner message ends the window. Held notes stay. */
export function endQuietOnOwnerMessage(db: DatabaseSync): void {
  endQuietWindow(db);
}

export function noteQuietSilentSent(db: DatabaseSync, nowMs: number): void {
  db.prepare(
    "UPDATE quiet_windows SET silent_notes_sent = silent_notes_sent + 1 WHERE id = 1 AND until_ms > ?",
  ).run(nowMs);
}

function ensureHeldState(db: DatabaseSync): void {
  db.prepare(
    "INSERT INTO quiet_held_state (id, dropped_count, shown_cycle_id) VALUES (1, 0, NULL) ON CONFLICT(id) DO NOTHING",
  ).run();
}

export function holdQuietDraft(db: DatabaseSync, text: string, nowMs: number): { dropped: boolean } {
  const stored = text.slice(0, QUIET_STORED_TEXT_CHARS);
  ensureHeldState(db);
  const count = Number((db.prepare("SELECT COUNT(*) AS n FROM quiet_held_notes").get() as Row).n ?? 0);
  let dropped = false;
  if (count >= QUIET_HELD_CAP) {
    db.prepare(
      `DELETE FROM quiet_held_notes WHERE held_id = (
         SELECT held_id FROM quiet_held_notes ORDER BY held_at_ms ASC, held_id ASC LIMIT 1
       )`,
    ).run();
    db.prepare("UPDATE quiet_held_state SET dropped_count = dropped_count + 1, shown_cycle_id = NULL WHERE id = 1").run();
    dropped = true;
  } else {
    db.prepare("UPDATE quiet_held_state SET shown_cycle_id = NULL WHERE id = 1").run();
  }
  db.prepare("INSERT INTO quiet_held_notes (text, held_at_ms) VALUES (?, ?)").run(stored, nowMs);
  return { dropped };
}

export function recordQuietRefusal(db: DatabaseSync, nowMs: number): void {
  db.prepare(
    `INSERT INTO quiet_refusals (id, at_ms, shown_cycle_id) VALUES (1, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET at_ms = excluded.at_ms, shown_cycle_id = NULL`,
  ).run(nowMs);
}

function claimShown(
  db: DatabaseSync,
  table: "quiet_held_state" | "quiet_refusals" | "owner_presence_facts",
  cycleId: string,
  claim: boolean,
): boolean {
  const row = db.prepare(`SELECT shown_cycle_id FROM ${table} WHERE id = 1`).get() as Row | undefined;
  if (!row) return false;
  const shown = typeof row.shown_cycle_id === "string" ? row.shown_cycle_id : null;
  if (shown && shown !== cycleId) return false;
  if (!shown && claim) db.prepare(`UPDATE ${table} SET shown_cycle_id = ? WHERE id = 1`).run(cycleId);
  return true;
}

export function quietFactsForPass(db: DatabaseSync, cycleId: string, nowMs: number, claim = true): QuietPassFacts {
  const facts: QuietPassFacts = {};
  const refusal = db.prepare("SELECT at_ms, shown_cycle_id FROM quiet_refusals WHERE id = 1").get() as Row | undefined;
  if (refusal && claimShown(db, "quiet_refusals", cycleId, claim)) {
    facts.quietRefusal = { code: "quiet_held", atMs: Number(refusal.at_ms) };
  }
  if (!readOpenQuietWindow(db, nowMs)) {
    const state = db.prepare("SELECT dropped_count, shown_cycle_id FROM quiet_held_state WHERE id = 1").get() as Row | undefined;
    const count = Number((db.prepare("SELECT COUNT(*) AS n FROM quiet_held_notes").get() as Row | undefined)?.n ?? 0);
    const droppedCount = Number(state?.dropped_count ?? 0);
    if (state && (count > 0 || droppedCount > 0) && claimShown(db, "quiet_held_state", cycleId, claim)) {
      const items = (db.prepare(
        "SELECT text FROM quiet_held_notes ORDER BY held_at_ms DESC, held_id DESC LIMIT ?",
      ).all(QUIET_HELD_PREVIEW) as Row[]).map((row) => String(row.text).slice(0, QUIET_HELD_TEXT_CHARS));
      facts.heldWhileQuiet = { count, items, droppedCount };
    }
  }
  const presence = db.prepare("SELECT status, since_ms FROM owner_presence_facts WHERE id = 1").get() as Row | undefined;
  if (presence && (presence.status === "online" || presence.status === "idle") && claimShown(db, "owner_presence_facts", cycleId, claim)) {
    facts.ownerPresence = { status: presence.status, sinceMs: Number(presence.since_ms) };
  }
  return facts;
}

export function recordOwnerPresence(
  db: DatabaseSync,
  input: { status: string; sinceMs: number },
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  if (input.status !== "online" && input.status !== "idle") return false;
  if (!Number.isSafeInteger(input.sinceMs) || input.sinceMs < 0) return false;
  db.prepare(
    `INSERT INTO owner_presence_facts (id, status, since_ms, shown_cycle_id) VALUES (1, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, since_ms = excluded.since_ms, shown_cycle_id = NULL`,
  ).run(input.status, input.sinceMs);
  return true;
}

export function quietGateApplies(input: {
  external: boolean;
  ownerPrivate: boolean;
  speechMode: string;
  triggerKind: string;
  interactionIntent: string | null;
}): boolean {
  if (input.external || !input.ownerPrivate || input.speechMode !== "draft") return false;
  if (input.triggerKind === "owner_message") return false;
  if (isUnsolicitedTriggerKind(input.triggerKind)) return true;
  return OPTIONAL_INITIATIVE.has(input.triggerKind) && input.interactionIntent === "initiate";
}

export function quietPublicationFor(
  db: DatabaseSync,
  input: {
    nowMs: number;
    external: boolean;
    ownerPrivate: boolean;
    speechMode: string;
    triggerKind: string;
    interactionIntent: string | null;
    draftText: string;
  },
): QuietPublication {
  if (!quietGateApplies(input)) return { kind: "allow" };
  const open = readOpenQuietWindow(db, input.nowMs);
  if (!open) return { kind: "allow" };
  if (open.silentNotesSent < QUIET_SILENT_CAP) return { kind: "silent" };
  return { kind: "hold", text: input.draftText };
}

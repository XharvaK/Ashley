import type { ConversationEvidenceRecord } from "../types.js";

/**
 * Growth V1 §4.6.5: Ashley's sense of time. Messages only carry epoch
 * timestamps; the clock gives Thought the local date, weekday, and time of
 * day in the Owner's zone, and how long it has been since each side last
 * spoke. Host facts only; what the time means is Thought's to decide.
 */
export type ThoughtClock = Readonly<{
  /** Local wall time, e.g. "Tuesday 29 September 2026, 17:52". */
  now: string;
  /** Offset label of the Owner's zone, e.g. "UTC+03:00". */
  timeZone: string;
  partOfDay: "night" | "morning" | "afternoon" | "evening";
  /** The Owner's latest message before the one being answered, if any. */
  ownerPreviousMessage?: ClockMark;
  /** Ashley's latest message in this conversation, if any. */
  ashleyLastMessage?: ClockMark;
}>;

export type ClockMark = Readonly<{ at: string; ago: string }>;

/** Fixed UTC+3 by default; any IANA zone may be configured instead. */
export const DEFAULT_OWNER_TIME_ZONE = "Etc/GMT-3";

function parts(ms: number, timeZone: string): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(ms));
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function wallTime(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function offsetLabel(ms: number, timeZone: string): string {
  const name = parts(ms, timeZone).timeZoneName ?? "GMT";
  const offset = name.replace(/^GMT/, "");
  return offset ? `UTC${offset}` : "UTC+00:00";
}

function partOfDay(ms: number, timeZone: string): ThoughtClock["partOfDay"] {
  const hour = Number(parts(ms, timeZone).hour);
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return hour < 22 ? "evening" : "night";
}

const UNITS: ReadonlyArray<[string, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** Coarse human duration: the two largest non-zero units. */
export function humanDuration(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const pieces: string[] = [];
  let rest = ms;
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) pieces.push(`${count} ${unit}${count === 1 ? "" : "s"}`);
    if (pieces.length === 2) break;
  }
  return pieces.join(" ");
}

function mark(row: ConversationEvidenceRecord | undefined, nowMs: number, timeZone: string): ClockMark | undefined {
  if (!row) return undefined;
  return { at: wallTime(row.createdAtMs, timeZone), ago: humanDuration(Math.max(0, nowMs - row.createdAtMs)) };
}

export function buildThoughtClock(input: {
  nowMs: number;
  timeZone?: string;
  rows: readonly ConversationEvidenceRecord[];
  /** Rows being answered now; they are not "previous". */
  currentRowIds?: ReadonlySet<string>;
}): ThoughtClock {
  const timeZone = input.timeZone || DEFAULT_OWNER_TIME_ZONE;
  const current = input.currentRowIds ?? new Set<string>();
  const ordered = [...input.rows]
    .filter((row) => row.createdAtMs <= input.nowMs)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  const latest = (role: string, excludeCurrent: boolean) =>
    ordered.filter((row) => row.role === role && !(excludeCurrent && current.has(row.rowId))).at(-1);
  const ownerPrevious = mark(latest("owner", true), input.nowMs, timeZone);
  const ashleyLast = mark(latest("ashley", false), input.nowMs, timeZone);
  return Object.freeze({
    now: wallTime(input.nowMs, timeZone),
    timeZone: offsetLabel(input.nowMs, timeZone),
    partOfDay: partOfDay(input.nowMs, timeZone),
    ...(ownerPrevious ? { ownerPreviousMessage: ownerPrevious } : {}),
    ...(ashleyLast ? { ashleyLastMessage: ashleyLast } : {}),
  });
}

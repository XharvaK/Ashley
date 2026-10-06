// T: teachers (User 2026-10-06: "like sending my child to a private teacher"). People the Owner trusts
// may teach her. In a turn with someone she may keep what was worth keeping (`learned`), in her own words,
// with what it made her curious about; not a transcript. The Host binds each lesson to the person who
// spoke and the place. Her own time sees recent lessons with her places, so she can bring one to the
// Owner, make it a pursuit or let it grow an interest. A teacher's words are teaching to weigh: they
// never change who she is on their own (growth keeps its own rules).
import type { DatabaseSync } from "node:sqlite";
import { discordName, placeLabel } from "../places/places.js";

export const LESSONS_PER_TURN = 3;
export const LESSON_MAX_CHARS = 300;
export const LESSON_CURIOUS_MAX_CHARS = 200;
export const TEACHER_SUBJECT_MAX_CHARS = 80;
export const LESSONS_SHOWN = 10;
export const LESSONS_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type LearnedClaim = { what: string; curiousAbout?: string };
export type ThoughtLesson = { from: string; teaches?: string; place: string; what: string; curiousAbout?: string; atMs: number };
export type ThoughtTeacher = { name: string; teaches: string };

type Row = Record<string, unknown>;

export function isLearnedClaims(value: unknown): value is LearnedClaim[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LESSONS_PER_TURN) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Row;
    if (Object.keys(record).some(key => key !== "what" && key !== "curiousAbout")) return false;
    return typeof record.what === "string" && record.what.trim().length >= 1 && record.what.length <= LESSON_MAX_CHARS
      && (record.curiousAbout === undefined
        || (typeof record.curiousAbout === "string" && record.curiousAbout.trim().length >= 1 && record.curiousAbout.length <= LESSON_CURIOUS_MAX_CHARS));
  });
}

/** Keep what she learned in one settled turn, once; bound to the person whose message started it. */
export function recordLessons(sidecar: DatabaseSync, input: {
  cycleId: string; fromPrincipal: string; placeRef: string; claims: readonly LearnedClaim[]; nowMs: number;
}): number {
  const insert = sidecar.prepare(`INSERT OR IGNORE INTO lessons (lesson_id, cycle_id, ordinal, from_principal, place_ref, what, curious_about, at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let kept = 0;
  input.claims.slice(0, LESSONS_PER_TURN).forEach((claim, ordinal) => {
    kept += Number(insert.run(`lesson:${input.cycleId}:${ordinal}`, input.cycleId, ordinal, input.fromPrincipal, input.placeRef,
      claim.what.trim(), claim.curiousAbout?.trim() || null, input.nowMs).changes ?? 0);
  });
  return kept;
}

// ---- teachers (the Owner's choice) ------------------------------------------------------------

export function setTeacher(sidecar: DatabaseSync, principalId: string, subject: string | null, nowMs: number): void {
  const teaches = subject?.trim().slice(0, TEACHER_SUBJECT_MAX_CHARS);
  if (!teaches) { sidecar.prepare("DELETE FROM teachers WHERE principal_id = ?").run(principalId); return; }
  sidecar.prepare(`INSERT INTO teachers (principal_id, subject, set_at_ms) VALUES (?, ?, ?)
    ON CONFLICT(principal_id) DO UPDATE SET subject = excluded.subject, set_at_ms = excluded.set_at_ms`).run(principalId, teaches, nowMs);
}

export function teacherSubject(sidecar: DatabaseSync, principalId: string): string | null {
  const row = sidecar.prepare("SELECT subject FROM teachers WHERE principal_id = ?").get(principalId) as Row | undefined;
  return typeof row?.subject === "string" ? row.subject : null;
}

export function listTeachers(sidecar: DatabaseSync): Array<{ principalId: string; teaches: string }> {
  return (sidecar.prepare("SELECT principal_id, subject FROM teachers ORDER BY set_at_ms").all() as Row[])
    .map(row => ({ principalId: String(row.principal_id), teaches: String(row.subject) }));
}

/** In a turn with a teacher: who they are to her. */
export function teacherForThought(sidecar: DatabaseSync, principalId: string | null | undefined): ThoughtTeacher | undefined {
  if (!principalId) return undefined;
  const teaches = teacherSubject(sidecar, principalId);
  if (!teaches) return undefined;
  return { name: discordName(sidecar, "user", principalId) ?? "your teacher", teaches };
}

/** What she kept lately, newest last, for her Owner-private turns. */
export function lessonsForThought(sidecar: DatabaseSync, nowMs: number): ThoughtLesson[] {
  return (sidecar.prepare(`SELECT l.from_principal, l.place_ref, l.what, l.curious_about, l.at_ms, t.subject FROM lessons l
    LEFT JOIN teachers t ON t.principal_id = l.from_principal WHERE l.at_ms > ? ORDER BY l.at_ms DESC LIMIT ?`)
    .all(nowMs - LESSONS_WINDOW_MS, LESSONS_SHOWN) as Row[]).reverse().map(row => ({
      from: discordName(sidecar, "user", String(row.from_principal)) ?? "someone",
      ...(typeof row.subject === "string" ? { teaches: row.subject } : {}),
      place: placeLabel(sidecar, String(row.place_ref)),
      what: String(row.what),
      ...(typeof row.curious_about === "string" ? { curiousAbout: row.curious_about } : {}),
      atMs: Number(row.at_ms),
    }));
}

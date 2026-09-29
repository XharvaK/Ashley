import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";

/**
 * Growth V1 §6.5: expectations and calibration (a light port of c4).
 *
 * Ashley may record what she expects ("Alex will enjoy this article"). A
 * later pass, usually an afterglow or an awake pass, checks it against
 * what actually happened and says what she learned. A checked expectation
 * is self-evidence: it can ground a revision, so experience becomes a
 * learned outcome. The Host keeps ids, time, and expiry; it never judges
 * whether an expectation was met.
 */

export const EXPECTATION_OUTCOMES = ["met", "missed", "mixed", "unknowable"] as const;
export type ExpectationOutcome = (typeof EXPECTATION_OUTCOMES)[number];
export type ExpectationStatus = "open" | ExpectationOutcome | "expired";

export const EXPECTATION_STATEMENT_MAX_CHARS = 300;
export const EXPECTATION_LESSON_MAX_CHARS = 400;
export const EXPECTATIONS_PER_SETTLEMENT = 3;
export const EXPECTATION_CHECKS_PER_SETTLEMENT = 5;
/** An expectation nobody checked for two weeks has stopped meaning anything. */
export const EXPECTATION_OPEN_TTL_MS = 14 * 24 * 60 * 60_000;
export const EXPECTATIONS_THOUGHT_LIMIT = 8;
export const LESSONS_THOUGHT_LIMIT = 5;

export type ExpectationCheck = { expectationId: string; outcome: ExpectationOutcome; lesson: string };

export type ExpectationRecord = {
  expectationId: string;
  cycleId: string;
  statement: string;
  status: ExpectationStatus;
  lesson: string | null;
  dataClassification: DataClassification;
  createdAtMs: number;
  checkedAtMs: number | null;
};

type Row = Record<string, unknown>;

const OUTCOMES = new Set<string>(EXPECTATION_OUTCOMES);

export function isExpectationOutcome(value: unknown): value is ExpectationOutcome {
  return typeof value === "string" && OUTCOMES.has(value);
}

function classification(value: unknown): DataClassification {
  return value === "sensitive" || value === "never_public" || value === "secret" ? value : "ordinary";
}

function mapExpectation(row: Row): ExpectationRecord {
  const status = String(row.status);
  return {
    expectationId: String(row.expectation_id),
    cycleId: String(row.cycle_id),
    statement: typeof row.statement === "string" ? row.statement : "",
    status: (status === "open" || status === "expired" || OUTCOMES.has(status) ? status : "open") as ExpectationStatus,
    lesson: typeof row.lesson === "string" ? row.lesson : null,
    dataClassification: classification(row.data_classification),
    createdAtMs: Number(row.created_at_ms ?? 0),
    checkedAtMs: row.checked_at_ms == null ? null : Number(row.checked_at_ms),
  };
}

export function expectationIdFor(cycleId: string, index: number): string {
  return `expectation:${createHash("sha256").update(`${cycleId}\n${index}`).digest("hex").slice(0, 32)}`;
}

/** Record what Ashley expects. Idempotent per cycle and position. */
export function recordExpectations(
  db: DatabaseSync,
  input: { cycleId: string; statements: readonly string[]; dataClassification: DataClassification; nowMs: number },
): string[] {
  const ids: string[] = [];
  input.statements.slice(0, EXPECTATIONS_PER_SETTLEMENT).forEach((raw, index) => {
    const statement = raw.trim().slice(0, EXPECTATION_STATEMENT_MAX_CHARS);
    if (!statement) return;
    const expectationId = expectationIdFor(input.cycleId, index);
    db.prepare(
      `INSERT OR IGNORE INTO expectations
         (expectation_id, cycle_id, statement, status, data_classification, created_at_ms)
       VALUES (?, ?, ?, 'open', ?, ?)`,
    ).run(expectationId, input.cycleId, statement, input.dataClassification, input.nowMs);
    ids.push(expectationId);
  });
  return ids;
}

/**
 * Close the expectations Ashley checked. Only open ones close, and never in
 * the cycle that made them: a check needs something to have happened.
 */
export function checkExpectations(
  db: DatabaseSync,
  input: { cycleId: string; checks: readonly ExpectationCheck[]; nowMs: number },
): string[] {
  const closed: string[] = [];
  for (const check of input.checks.slice(0, EXPECTATION_CHECKS_PER_SETTLEMENT)) {
    if (!isExpectationOutcome(check.outcome)) continue;
    const lesson = check.lesson.trim().slice(0, EXPECTATION_LESSON_MAX_CHARS);
    if (!lesson) continue;
    const result = db.prepare(
      `UPDATE expectations
          SET status = ?, lesson = ?, checked_cycle_id = ?, checked_at_ms = ?
        WHERE expectation_id = ? AND status = 'open' AND cycle_id != ? AND forgotten_at_ms IS NULL`,
    ).run(check.outcome, lesson, input.cycleId, input.nowMs, check.expectationId, input.cycleId);
    if (Number(result.changes ?? 0) > 0) closed.push(check.expectationId);
  }
  return closed;
}

export function expireStaleExpectations(db: DatabaseSync, nowMs: number): number {
  return Number(db.prepare(
    "UPDATE expectations SET status = 'expired', checked_at_ms = ? WHERE status = 'open' AND created_at_ms < ?",
  ).run(nowMs, nowMs - EXPECTATION_OPEN_TTL_MS).changes ?? 0);
}

export function getExpectation(db: DatabaseSync, expectationId: string): ExpectationRecord | null {
  const row = db.prepare("SELECT * FROM expectations WHERE expectation_id = ? AND forgotten_at_ms IS NULL").get(expectationId) as Row | undefined;
  return row ? mapExpectation(row) : null;
}

/** Still-open expectations, oldest first; a secret one never leaves the store. */
export function listOpenExpectations(db: DatabaseSync, nowMs: number, limit = EXPECTATIONS_THOUGHT_LIMIT): ExpectationRecord[] {
  return (db.prepare(
    `SELECT * FROM expectations
      WHERE status = 'open' AND forgotten_at_ms IS NULL AND data_classification != 'secret' AND created_at_ms >= ?
      ORDER BY created_at_ms ASC, expectation_id ASC LIMIT ?`,
  ).all(nowMs - EXPECTATION_OPEN_TTL_MS, Math.max(1, limit)) as Row[]).map(mapExpectation);
}

/** Recently checked expectations and what she took from them, newest first. */
export function listRecentLessons(db: DatabaseSync, limit = LESSONS_THOUGHT_LIMIT): ExpectationRecord[] {
  return (db.prepare(
    `SELECT * FROM expectations
      WHERE status IN ('met', 'missed', 'mixed', 'unknowable') AND lesson IS NOT NULL
        AND forgotten_at_ms IS NULL AND data_classification != 'secret'
      ORDER BY checked_at_ms DESC, expectation_id DESC LIMIT ?`,
  ).all(Math.max(1, limit)) as Row[]).map(mapExpectation);
}

/** Expectations whose words mention a forgotten topic. */
export function expectationIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT expectation_id, statement, lesson FROM expectations WHERE forgotten_at_ms IS NULL").all() as Row[])
    .filter((row) => `${typeof row.statement === "string" ? row.statement : ""}\n${typeof row.lesson === "string" ? row.lesson : ""}`
      .toLowerCase().includes(needle))
    .map((row) => String(row.expectation_id));
}

/** Her words go; a forgotten expectation no longer counts as evidence. */
export function forgetExpectation(db: DatabaseSync, expectationId: string, nowMs: number): number {
  return Number(db.prepare(
    "UPDATE expectations SET statement = '', lesson = NULL, forgotten_at_ms = ? WHERE expectation_id = ? AND forgotten_at_ms IS NULL",
  ).run(nowMs, expectationId).changes ?? 0);
}

import { recordHostFriction } from "../growth/friction.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import { getConversationEvidence } from "../evidence/conversation-log.js";
import { getMemoryAssertion } from "../memory/assertions.js";
import { listMemorySupports } from "../memory/supports.js";
import { recordThoughtCheck } from "../graduation/settlement.js";
import { detectCredentialShape } from "../../privacy/secrets.js";

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
/** An expectation, optionally naming the records whose word it rests on (A9). */
export type ExpectationClaim = string | {
  statement: string; basisRefs?: string[];
  judgmentClass?: string; observable?: string; horizonHours?: number;
  check?: "owner_reply" | "delivered";
};
export const EXPECTATION_BASIS_REFS_MAX = 5;
export const SOURCE_RECORDS_THOUGHT_LIMIT = 8;

export type ExpectationRecord = {
  expectationId: string;
  cycleId: string;
  statement: string;
  status: ExpectationStatus;
  lesson: string | null;
  dataClassification: DataClassification;
  createdAtMs: number;
  checkedAtMs: number | null;
  judgmentClass: string | null;
  observable: string | null;
  horizonHours: number | null;
  check: "owner_reply" | "delivered" | null;
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
    judgmentClass: typeof row.judgment_class === "string" ? row.judgment_class : null,
    observable: typeof row.observable === "string" ? row.observable : null,
    horizonHours: row.horizon_hours == null ? null : Number(row.horizon_hours),
    check: row.check_kind === "owner_reply" || row.check_kind === "delivered" ? row.check_kind : null,
  };
}

export function expectationIdFor(cycleId: string, index: number): string {
  return `expectation:${createHash("sha256").update(`${cycleId}\n${index}`).digest("hex").slice(0, 32)}`;
}

function hostnameOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function rowSource(db: DatabaseSync, rowId: string): string | null {
  const evidence = getConversationEvidence(db, rowId);
  return evidence?.role === "external_dialog" && evidence.speakerPrincipalId ? `contact:${evidence.speakerPrincipalId}` : null;
}

function observationSource(db: DatabaseSync, observationId: string): string | null {
  const row = db.prepare("SELECT payload_json FROM observations WHERE observation_id = ?").get(observationId) as Row | undefined;
  try {
    const payload = typeof row?.payload_json === "string" ? JSON.parse(row.payload_json) as Row : null;
    for (const key of ["finalUrl", "requestedUrl", "url"]) {
      const host = hostnameOf(payload?.[key]);
      if (host) return `web:${host}`;
    }
  } catch { /* unreadable payload names no source */ }
  return null;
}

/**
 * The contacts and websites a cited record rests on. Records of the Owner's
 * or her own name no outside source; unknown refs name nothing.
 */
export function sourcesForRef(db: DatabaseSync, ref: string): string[] {
  const fromRow = rowSource(db, ref);
  if (fromRow) return [fromRow];
  const fromObservation = observationSource(db, ref);
  if (fromObservation) return [fromObservation];
  const assertion = getMemoryAssertion(db, ref);
  if (!assertion) return [];
  const sources = new Set<string>();
  if (assertion.sourcePrincipal && assertion.audienceScope && assertion.audienceScope.kind !== "owner_private") {
    sources.add(`contact:${assertion.sourcePrincipal}`);
  }
  for (const support of listMemorySupports(db, ref)) {
    const supportRef = support.supportRef;
    const source = supportRef?.kind === "conversation_text_span" ? rowSource(db, supportRef.evidenceRowId)
      : supportRef?.kind === "observation_ref" ? observationSource(db, supportRef.observationId)
      : null;
    if (source) sources.add(source);
  }
  return [...sources];
}

/** Record what Ashley expects. Idempotent per cycle and position. */
export function recordExpectations(
  db: DatabaseSync,
  input: { cycleId: string; statements: readonly ExpectationClaim[]; dataClassification: DataClassification; nowMs: number },
): string[] {
  const ids: string[] = [];
  input.statements.slice(0, EXPECTATIONS_PER_SETTLEMENT).forEach((claim, index) => {
    const raw = typeof claim === "string" ? claim : claim.statement;
    const authored = typeof claim === "string" ? [claim] : [claim.statement, claim.judgmentClass, claim.observable].filter((value): value is string => typeof value === "string");
    if (authored.some(value => detectCredentialShape(value).hit)) return;
    const basisRefs = typeof claim === "string" ? [] : (claim.basisRefs ?? []).slice(0, EXPECTATION_BASIS_REFS_MAX);
    const statement = raw.trim().slice(0, EXPECTATION_STATEMENT_MAX_CHARS);
    if (!statement) return;
    const expectationId = expectationIdFor(input.cycleId, index);
    db.prepare(
      `INSERT OR IGNORE INTO expectations
         (expectation_id, cycle_id, statement, status, data_classification, created_at_ms,
          judgment_class, observable, horizon_hours, check_kind)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
    ).run(expectationId, input.cycleId, statement, input.dataClassification, input.nowMs,
      typeof claim === "string" ? null : claim.judgmentClass ?? null,
      typeof claim === "string" ? null : claim.observable ?? null,
      typeof claim === "string" ? null : claim.horizonHours ?? null,
      typeof claim === "string" ? null : claim.check ?? null);
    for (const source of new Set(basisRefs.flatMap((ref) => sourcesForRef(db, ref)))) {
      db.prepare("INSERT OR IGNORE INTO expectation_basis (expectation_id, source) VALUES (?, ?)").run(expectationId, source);
    }
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
  input: { cycleId: string; checks: readonly ExpectationCheck[]; dataClassification?: DataClassification; nowMs: number },
): string[] {
  const closed: string[] = [];
  for (const check of input.checks.slice(0, EXPECTATION_CHECKS_PER_SETTLEMENT)) {
    if (!isExpectationOutcome(check.outcome)) continue;
    if (detectCredentialShape(check.lesson).hit) continue;
    const lesson = check.lesson.trim().slice(0, EXPECTATION_LESSON_MAX_CHARS);
    if (!lesson) continue;
    const result = db.prepare(
      `UPDATE expectations
          SET status = ?, lesson = ?, checked_cycle_id = ?, checked_at_ms = ?,
              data_classification = CASE WHEN ? = 'never_public' AND data_classification != 'secret' THEN 'never_public' ELSE data_classification END
        WHERE expectation_id = ? AND status = 'open' AND cycle_id != ? AND forgotten_at_ms IS NULL`,
    ).run(check.outcome, lesson, input.cycleId, input.nowMs, input.dataClassification ?? "ordinary", check.expectationId, input.cycleId);
    if (Number(result.changes ?? 0) > 0) {
      closed.push(check.expectationId);
      recordThoughtCheck(db, { cycleId: input.cycleId, check, nowMs: input.nowMs, dataClassification: input.dataClassification });
      if (check.outcome === "missed") recordHostFriction(db, "expectation_missed", check.expectationId, input.nowMs, input.cycleId);
    }
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

export type SourceRecord = { source: string; met: number; missed: number; mixed: number; open: number };

/**
 * How what each source told her has held up: the expectations resting on a
 * contact's or a site's word, by outcome. Shown to Thought, never used to
 * rank anyone; she forms her own sense of whom to rely on, about what.
 */
export function listSourceRecords(db: DatabaseSync, limit = SOURCE_RECORDS_THOUGHT_LIMIT): SourceRecord[] {
  return (db.prepare(
    `SELECT b.source,
            SUM(CASE WHEN e.status = 'met' THEN 1 ELSE 0 END) AS met,
            SUM(CASE WHEN e.status = 'missed' THEN 1 ELSE 0 END) AS missed,
            SUM(CASE WHEN e.status = 'mixed' THEN 1 ELSE 0 END) AS mixed,
            SUM(CASE WHEN e.status = 'open' THEN 1 ELSE 0 END) AS open,
            MAX(COALESCE(e.checked_at_ms, e.created_at_ms)) AS last_ms
       FROM expectation_basis b JOIN expectations e ON e.expectation_id = b.expectation_id
      WHERE e.forgotten_at_ms IS NULL
      GROUP BY b.source
      ORDER BY last_ms DESC, b.source ASC
      LIMIT ?`,
  ).all(Math.max(1, limit)) as Row[]).map((row) => ({
    source: String(row.source),
    met: Number(row.met ?? 0),
    missed: Number(row.missed ?? 0),
    mixed: Number(row.mixed ?? 0),
    open: Number(row.open ?? 0),
  }));
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

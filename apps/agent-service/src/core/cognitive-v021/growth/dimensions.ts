import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { resolveRevisionEvidence } from "./revisions.js";

export const ACTIVE_DIMENSION_CAP = 8;

export type GrowthDimension = {
  id: string;
  name: string;
  question: string;
  status: "active" | "retired";
  origin: "owner_seed" | "ashley";
  createdAtMs: number;
  updatedAtMs: number;
};

export type GrowthDimensionHistory = {
  historyId: string;
  dimensionId: string;
  op: "add" | "rename" | "retire" | "revert";
  actor: "owner" | "ashley";
  reason: string | null;
  before: { name: string; question: string; status: string } | null;
  after: { name: string; question: string; status: string } | null;
  createdAtMs: number;
};

export type GapScoreInput = { id: string; score: number; note?: string; supportRefs?: string[] };
export type GapEditInput = { op: "add" | "rename" | "retire"; id?: string; name?: string; question?: string; reason?: string };

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function snapshot(row: { name: string; question: string; status: string }): string {
  return JSON.stringify({ name: row.name, question: row.question, status: row.status });
}

function parseSnapshot(value: unknown): GrowthDimensionHistory["before"] {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as { name?: unknown; question?: unknown; status?: unknown };
    if (typeof parsed.name !== "string" || typeof parsed.question !== "string" || typeof parsed.status !== "string") return null;
    return { name: parsed.name, question: parsed.question, status: parsed.status };
  } catch {
    return null;
  }
}

function mapDimension(row: Row): GrowthDimension {
  return {
    id: String(row.id),
    name: String(row.name),
    question: String(row.weekly_question),
    status: row.status === "retired" ? "retired" : "active",
    origin: row.origin === "ashley" ? "ashley" : "owner_seed",
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export function listActiveDimensions(db: DatabaseSync): GrowthDimension[] {
  return (db.prepare("SELECT * FROM growth_dimensions WHERE status='active' ORDER BY created_at_ms, id").all() as Row[]).map(mapDimension);
}

export function listGrowthDimensions(db: DatabaseSync): { dimensions: GrowthDimension[]; history: GrowthDimensionHistory[] } {
  const dimensions = (db.prepare("SELECT * FROM growth_dimensions ORDER BY created_at_ms, id").all() as Row[]).map(mapDimension);
  const history = (db.prepare("SELECT * FROM growth_dimension_history ORDER BY created_at_ms DESC, history_id DESC LIMIT 40").all() as Row[])
    .map((row) => ({
      historyId: String(row.history_id),
      dimensionId: String(row.dimension_id),
      op: String(row.op) as GrowthDimensionHistory["op"],
      actor: row.actor === "ashley" ? "ashley" as const : "owner" as const,
      reason: row.reason == null ? null : String(row.reason),
      before: parseSnapshot(row.before_json),
      after: parseSnapshot(row.after_json),
      createdAtMs: Number(row.created_at_ms),
    }));
  return { dimensions, history };
}

function activeCount(db: DatabaseSync): number {
  return Number((db.prepare("SELECT count(*) AS n FROM growth_dimensions WHERE status='active'").get() as Row).n);
}

function writeHistory(db: DatabaseSync, input: {
  dimensionId: string; op: GrowthDimensionHistory["op"]; actor: "owner" | "ashley"; reason: string | null;
  before: string | null; after: string | null; nowMs: number;
}): void {
  db.prepare(
    `INSERT INTO growth_dimension_history (history_id, dimension_id, op, actor, reason, before_json, after_json, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), input.dimensionId, input.op, input.actor, input.reason, input.before, input.after, input.nowMs);
}

export function seedGrowthDimension(db: DatabaseSync, input: { name: string; question: string; nowMs: number }): GrowthDimension {
  if (typeof input.name !== "string" || input.name.trim() === "" || typeof input.question !== "string" || input.question.trim() === "") {
    throw new Error("growth_dimension_text_required");
  }
  if (activeCount(db) >= ACTIVE_DIMENSION_CAP) throw new Error("growth_dimension_cap");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO growth_dimensions (id, name, weekly_question, status, origin, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, 'active', 'owner_seed', ?, ?)`,
  ).run(id, input.name, input.question, input.nowMs, input.nowMs);
  const after = { name: input.name, question: input.question, status: "active" };
  writeHistory(db, { dimensionId: id, op: "add", actor: "owner", reason: "owner seed", before: null, after: snapshot(after), nowMs: input.nowMs });
  return mapDimension(db.prepare("SELECT * FROM growth_dimensions WHERE id=?").get(id) as Row);
}

function dimensionById(db: DatabaseSync, id: string): GrowthDimension | null {
  const row = db.prepare("SELECT * FROM growth_dimensions WHERE id=?").get(id) as Row | undefined;
  return row ? mapDimension(row) : null;
}

export type AppliedGaps = { stored: number; dropped: number; chosenId: string | null; editsApplied: number; editsRefused: number };

/** Store weekly gap scores and Ashley's notify-only edits. Scores are stored as authored. */
export function applyWeeklyGaps(
  db: DatabaseSync,
  input: {
    passId: string;
    nowMs: number;
    dataClassification: string;
    dimensions?: GapScoreInput[];
    choose?: string;
    edits?: GapEditInput[];
  },
): AppliedGaps {
  const result: AppliedGaps = { stored: 0, dropped: 0, chosenId: null, editsApplied: 0, editsRefused: 0 };
  const seen = new Set<string>();
  const accepted: GapScoreInput[] = [];
  let duplicate = false;
  for (const item of input.dimensions ?? []) {
    const note = typeof item.note === "string" ? item.note : "";
    const refs = Array.isArray(item.supportRefs) ? item.supportRefs.filter((ref) => typeof ref === "string" && ref.trim() !== "") : [];
    const active = dimensionById(db, item.id);
    const resolvable = refs.some((ref) => resolveRevisionEvidence(db, ref) !== null);
    const scoreOk = typeof item.score === "number" && Number.isInteger(item.score) && item.score >= 0 && item.score <= 5;
    if (!active || active.status !== "active" || note.trim() === "" || !resolvable || !scoreOk || seen.has(item.id)) {
      result.dropped += 1;
      if (seen.has(item.id) && active && note.trim() !== "" && resolvable && scoreOk) duplicate = true;
      continue;
    }
    seen.add(item.id);
    accepted.push({ id: item.id, score: item.score, note, supportRefs: refs });
  }
  db.exec("SAVEPOINT growth_gap_rows");
  try {
    for (const item of accepted) {
      const inserted = db.prepare(
        `INSERT INTO growth_gap_scores (pass_id, dimension_id, score, note, support_refs_json, chosen, data_classification, created_at_ms)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(input.passId, item.id, item.score, item.note, JSON.stringify(item.supportRefs), input.dataClassification, input.nowMs);
      if (Number(inserted.changes ?? 0) !== 1) throw new Error("growth_gap_partial");
      result.stored += 1;
    }
    if (duplicate) throw new Error("growth_gap_partial");
    if (input.choose && accepted.some((item) => item.id === input.choose)) {
      db.prepare("UPDATE growth_gap_scores SET chosen=1 WHERE pass_id=? AND dimension_id=?").run(input.passId, input.choose);
      result.chosenId = input.choose;
    }
    for (const edit of input.edits ?? []) applyEdit(db, edit, input.nowMs, result);
    if (result.dropped > 0) {
      db.prepare(
        `INSERT INTO growth_gap_diagnostics (pass_id, dropped, created_at_ms) VALUES (?, ?, ?)
         ON CONFLICT(pass_id) DO UPDATE SET dropped=excluded.dropped`,
      ).run(input.passId, result.dropped, input.nowMs);
    }
    db.exec("RELEASE growth_gap_rows");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO growth_gap_rows; RELEASE growth_gap_rows");
    throw error;
  }
}

function applyEdit(db: DatabaseSync, edit: GapEditInput, nowMs: number, result: AppliedGaps): void {
  const reason = typeof edit.reason === "string" && edit.reason.trim() !== "" ? edit.reason : "";
  if (!reason) {
    result.editsRefused += 1;
    return;
  }
  if (edit.op === "add") {
    const name = typeof edit.name === "string" ? edit.name : "";
    const question = typeof edit.question === "string" ? edit.question : "";
    if (name.trim() === "" || question.trim() === "" || activeCount(db) >= ACTIVE_DIMENSION_CAP) {
      writeHistory(db, {
        dimensionId: `refused:${randomUUID()}`, op: "add", actor: "ashley", reason,
        before: null, after: snapshot({ name, question, status: "refused" }), nowMs,
      });
      result.editsRefused += 1;
      return;
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO growth_dimensions (id, name, weekly_question, status, origin, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'active', 'ashley', ?, ?)`,
    ).run(id, name, question, nowMs, nowMs);
    writeHistory(db, { dimensionId: id, op: "add", actor: "ashley", reason, before: null, after: snapshot({ name, question, status: "active" }), nowMs });
    result.editsApplied += 1;
    return;
  }
  const current = edit.id ? dimensionById(db, edit.id) : null;
  if (!current || current.status !== "active") {
    result.editsRefused += 1;
    return;
  }
  if (edit.op === "rename") {
    const name = typeof edit.name === "string" && edit.name.trim() !== "" ? edit.name : current.name;
    const question = typeof edit.question === "string" && edit.question.trim() !== "" ? edit.question : current.question;
    db.prepare("UPDATE growth_dimensions SET name=?, weekly_question=?, updated_at_ms=? WHERE id=?").run(name, question, nowMs, current.id);
    writeHistory(db, {
      dimensionId: current.id, op: "rename", actor: "ashley", reason,
      before: snapshot(current), after: snapshot({ name, question, status: current.status }), nowMs,
    });
    result.editsApplied += 1;
    return;
  }
  db.prepare("UPDATE growth_dimensions SET status='retired', updated_at_ms=? WHERE id=?").run(nowMs, current.id);
  writeHistory(db, {
    dimensionId: current.id, op: "retire", actor: "ashley", reason,
    before: snapshot(current), after: snapshot({ ...current, status: "retired" }), nowMs,
  });
  result.editsApplied += 1;
}

export function latestChosenGap(db: DatabaseSync): GrowthDimension | null {
  const row = db.prepare(
    `SELECT d.* FROM growth_gap_scores s
     JOIN growth_dimensions d ON d.id = s.dimension_id
     WHERE s.chosen=1 AND d.status='active' AND s.note IS NOT NULL
     ORDER BY s.created_at_ms DESC, s.pass_id DESC LIMIT 1`,
  ).get() as Row | undefined;
  return row ? mapDimension(row) : null;
}

export function revertAshleyDimensionEdit(db: DatabaseSync, input: { dimensionId: string; nowMs: number }): { reverted: boolean } {
  const row = db.prepare(
    `SELECT * FROM growth_dimension_history WHERE dimension_id=? AND actor='ashley' AND op!='revert'
     ORDER BY created_at_ms DESC, history_id DESC LIMIT 1`,
  ).get(input.dimensionId) as Row | undefined;
  if (!row) return { reverted: false };
  const current = dimensionById(db, input.dimensionId);
  const before = parseSnapshot(row.before_json);
  const op = String(row.op);
  if (op === "add") {
    if (!current) return { reverted: false };
    db.prepare("UPDATE growth_dimensions SET status='retired', updated_at_ms=? WHERE id=?").run(input.nowMs, current.id);
    writeHistory(db, { dimensionId: current.id, op: "revert", actor: "owner", reason: "owner revert", before: snapshot(current), after: snapshot({ ...current, status: "retired" }), nowMs: input.nowMs });
    return { reverted: true };
  }
  if (!current || !before || (before.status !== "active" && before.status !== "retired")) return { reverted: false };
  if (before.status === "active" && current.status !== "active" && activeCount(db) >= ACTIVE_DIMENSION_CAP) return { reverted: false };
  db.prepare("UPDATE growth_dimensions SET name=?, weekly_question=?, status=?, updated_at_ms=? WHERE id=?")
    .run(before.name, before.question, before.status, input.nowMs, current.id);
  writeHistory(db, {
    dimensionId: current.id, op: "revert", actor: "owner", reason: "owner revert",
    before: snapshot(current), after: snapshot({ name: before.name, question: before.question, status: before.status }), nowMs: input.nowMs,
  });
  return { reverted: true };
}

export function gapScoreIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT pass_id, dimension_id, note FROM growth_gap_scores WHERE note IS NOT NULL").all() as Row[])
    .filter((row) => String(row.note).toLowerCase().includes(needle))
    .map((row) => `${String(row.pass_id)}:${String(row.dimension_id)}`);
}

export function dimensionHistoryIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT history_id, reason, before_json, after_json FROM growth_dimension_history").all() as Row[])
    .filter((row) => [row.reason, row.before_json, row.after_json].some((value) => typeof value === "string" && value.toLowerCase().includes(needle)))
    .map((row) => String(row.history_id));
}

export function forgetGapScore(db: DatabaseSync, id: string): number {
  const separator = id.indexOf(":");
  if (separator <= 0) return 0;
  return Number(db.prepare("UPDATE growth_gap_scores SET note=NULL, support_refs_json='[]' WHERE pass_id=? AND dimension_id=? AND note IS NOT NULL")
    .run(id.slice(0, separator), id.slice(separator + 1)).changes ?? 0);
}

export function forgetDimensionHistory(db: DatabaseSync, historyId: string): number {
  return Number(db.prepare("UPDATE growth_dimension_history SET reason=NULL, before_json=NULL, after_json=NULL WHERE history_id=? AND (reason IS NOT NULL OR before_json IS NOT NULL OR after_json IS NOT NULL)")
    .run(historyId).changes ?? 0);
}

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ConcernDelta, ConcernRecord, CycleId, Generation } from "../types.js";

export type ConcernPublication = { cycleId: CycleId; generation: Generation };
type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row { return typeof value === "object" && value !== null; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function json(value: unknown, fallback: unknown): unknown { try { return JSON.parse(text(value)); } catch { return fallback; } }

function mapConcern(row: unknown): ConcernRecord | null {
  if (!isRow(row)) return null;
  const sourceTurnIds = json(row.source_refs_json, []);
  const dimensions = json(row.dimensions_json, null);
  if (!Array.isArray(sourceTurnIds) || !isRow(dimensions)) return null;
  return {
    concernId: text(row.concern_id),
    conversationId: text(row.conversation_id),
    statement: text(row.statement),
    sourceTurnIds: sourceTurnIds.filter((id): id is string => typeof id === "string"),
    dimensions: dimensions as ConcernRecord["dimensions"],
    assertionKey: row.assertion_key == null ? null : text(row.assertion_key),
    status: text(row.status) as ConcernRecord["status"],
    snapshotHash: text(row.snapshot_hash),
  };
}

export function getConcern(db: DatabaseSync, concernId: string): ConcernRecord | null {
  return mapConcern(db.prepare("SELECT * FROM concerns WHERE concern_id = ?").get(concernId));
}

export function listConcerns(db: DatabaseSync, conversationId: string): ConcernRecord[] {
  return db.prepare("SELECT * FROM concerns WHERE conversation_id = ? ORDER BY concern_id ASC").all(conversationId)
    .map(mapConcern)
    .filter((row): row is ConcernRecord => row !== null);
}

export function concernSnapshotHash(record: Omit<ConcernRecord, "snapshotHash">): string {
  return createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex");
}

export function applyConcernDelta(
  db: DatabaseSync,
  delta: ConcernDelta,
  publication: ConcernPublication,
): void {
  if (delta.op === "resolve") {
    db.prepare("UPDATE concerns SET status = 'resolved', updated_cycle = ? WHERE concern_id = ?")
      .run(publication.cycleId, delta.concernId);
    return;
  }
  const record = delta.record;
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, status, snapshot_hash, updated_cycle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(concern_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       statement=excluded.statement, source_refs_json=excluded.source_refs_json,
       dimensions_json=excluded.dimensions_json, assertion_key=excluded.assertion_key,
       status=excluded.status, snapshot_hash=excluded.snapshot_hash, updated_cycle=excluded.updated_cycle`,
  ).run(
    record.concernId,
    record.conversationId,
    record.statement,
    JSON.stringify(record.sourceTurnIds),
    JSON.stringify(record.dimensions),
    record.assertionKey,
    record.status,
    concernSnapshotHash(record),
    publication.cycleId,
  );
}

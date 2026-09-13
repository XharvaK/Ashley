import type { DatabaseSync } from "node:sqlite";
import type {
  CycleId,
  Generation,
  WorkingContextDelta,
  WorkingContextItem,
} from "../types.js";

export type WorkingContextPublication = { cycleId: CycleId; generation: Generation };

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapItem(row: unknown, conversationId: string): WorkingContextItem | null {
  if (!isRow(row)) return null;
  const payload = parse(row.payload_json);
  if (!isRow(payload)) return null;
  const type = payload.type;
  const status = payload.status;
  if (
    type !== "topic" && type !== "referent" && type !== "correction" && type !== "owner_teaching" &&
    type !== "question" && type !== "commitment_temp" && type !== "repair"
  ) return null;
  if (status !== "active" && status !== "superseded" && status !== "abandoned") return null;
  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    conversationId,
    type,
    text: typeof payload.text === "string" ? payload.text : "",
    concernId: typeof payload.concernId === "string" ? payload.concernId : null,
    sourceTurnIds: strings(payload.sourceTurnIds),
    status,
    supersedesId: typeof payload.supersedesId === "string" ? payload.supersedesId : null,
    updatedGeneration: Number(row.updated_generation ?? payload.updatedGeneration ?? 0),
  };
}

export function listWorkingContext(
  db: DatabaseSync,
  conversationId: string,
  options: { includeSuperseded?: boolean; limit?: number } = {},
): WorkingContextItem[] {
  const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
  const filter = options.includeSuperseded ? "" : "AND superseded = 0";
  return db.prepare(
    `SELECT id, conversation_id, payload_json, superseded, updated_generation
       FROM working_context_items
      WHERE conversation_id = ? ${filter}
      ORDER BY COALESCE(updated_generation, 0) DESC, id ASC
      LIMIT ?`,
  ).all(conversationId, limit)
    .map((row) => mapItem(row, conversationId))
    .filter((row): row is WorkingContextItem => row !== null);
}

function put(
  db: DatabaseSync,
  item: Omit<WorkingContextItem, "updatedGeneration">,
  publication: WorkingContextPublication,
): void {
  db.prepare(
    `INSERT INTO working_context_items
       (id, conversation_id, type, payload_json, superseded, updated_cycle, updated_generation)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,
       type=excluded.type, payload_json=excluded.payload_json, superseded=excluded.superseded,
       updated_cycle=excluded.updated_cycle, updated_generation=excluded.updated_generation`,
  ).run(
    item.id,
    item.conversationId,
    item.type,
    JSON.stringify(item),
    item.status === "superseded" || item.status === "abandoned" ? 1 : 0,
    publication.cycleId,
    publication.generation,
  );
}

export function applyWorkingContextDelta(
  db: DatabaseSync,
  delta: WorkingContextDelta,
  publication: WorkingContextPublication,
): void {
  switch (delta.op) {
    case "upsert":
      put(db, delta.item, publication);
      return;
    case "supersede":
      db.prepare(
        "UPDATE working_context_items SET superseded = 1, updated_cycle = ?, updated_generation = ? WHERE id = ?",
      ).run(publication.cycleId, publication.generation, delta.id);
      put(db, delta.replacement, publication);
      return;
    case "abandon":
      db.prepare(
        "UPDATE working_context_items SET superseded = 1, updated_cycle = ?, updated_generation = ? WHERE id = ?",
      ).run(publication.cycleId, publication.generation, delta.id);
  }
}

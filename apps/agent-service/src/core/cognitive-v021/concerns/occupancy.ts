import type { DatabaseSync } from "node:sqlite";
import type { CycleId, Generation, MindOccupancy, OccupancyDelta } from "../types.js";

export type OccupancyPublication = { cycleId: CycleId; generation: Generation };
type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row { return typeof value === "object" && value !== null; }

export function listOccupancy(
  db: DatabaseSync,
  conversationId: string,
  limit = 1000,
): MindOccupancy[] {
  return db.prepare(
    `SELECT conversation_id, concern_id, status, priority, updated_cycle, updated_generation
       FROM mind_occupancy WHERE conversation_id = ?
       ORDER BY priority DESC, updated_generation DESC, concern_id ASC LIMIT ?`,
  ).all(conversationId, Math.max(1, Math.min(1000, limit))).flatMap((row) => {
    if (!isRow(row)) return [];
    return [{
      conversationId: String(row.conversation_id ?? conversationId),
      concernId: String(row.concern_id ?? ""),
      status: String(row.status ?? "active") as MindOccupancy["status"],
      priority: Number(row.priority ?? 0),
      updatedCycle: String(row.updated_cycle ?? ""),
      updatedGeneration: Number(row.updated_generation ?? 0),
    } satisfies MindOccupancy];
  });
}

export function applyOccupancyDelta(
  db: DatabaseSync,
  delta: OccupancyDelta,
  publication: OccupancyPublication,
): void {
  const occupancy = delta.occupancy;
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id, concern_id) DO UPDATE SET status=excluded.status,
       priority=excluded.priority, updated_cycle=excluded.updated_cycle,
       updated_generation=excluded.updated_generation`,
  ).run(
    occupancy.conversationId,
    occupancy.concernId,
    occupancy.status,
    occupancy.priority,
    publication.cycleId,
    occupancy.updatedGeneration,
  );
}

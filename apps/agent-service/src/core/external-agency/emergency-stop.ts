import type { DatabaseSync } from "node:sqlite";

function nowIso(): string {
  return new Date().toISOString();
}

export function getEmergencyStop(db: DatabaseSync, ownerId: string): boolean {
  const row = db
    .prepare(
      `SELECT emergency_stop FROM external_agency_state WHERE owner_id = ?`,
    )
    .get(ownerId) as { emergency_stop?: number } | undefined;
  return Number(row?.emergency_stop ?? 0) === 1;
}

export function setEmergencyStop(
  db: DatabaseSync,
  ownerId: string,
  active: boolean,
): { emergencyStop: boolean; emergencyStopAt: string | null } {
  const now = nowIso();
  const emergencyStopAt = active ? now : null;
  db.prepare(
    `INSERT INTO external_agency_state (owner_id, emergency_stop, emergency_stop_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       emergency_stop = excluded.emergency_stop,
       emergency_stop_at = excluded.emergency_stop_at,
       updated_at = excluded.updated_at`,
  ).run(ownerId, active ? 1 : 0, emergencyStopAt, now);
  return { emergencyStop: active, emergencyStopAt };
}

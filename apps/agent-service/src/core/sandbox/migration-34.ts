import type { DatabaseSync } from "node:sqlite";

function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const MIGRATION_34_DURABLE_COGNITION_DDL = `
CREATE INDEX IF NOT EXISTS idx_operational_jobs_cognition
  ON operational_jobs (cognition_state, next_thought_attempt_at_ms);
`;

/** Nuclear v34 — durable pre-Thought cognition on operational_jobs. No new effect class. */
export function ensureNuclearV34Schema(db: DatabaseSync): void {
  addColumnIfMissing(
    db,
    "operational_jobs",
    "job_phase",
    "TEXT NOT NULL DEFAULT 'execution_admitted'",
  );
  addColumnIfMissing(
    db,
    "operational_jobs",
    "cognition_state",
    "TEXT NOT NULL DEFAULT 'not_required'",
  );
  addColumnIfMissing(
    db,
    "operational_jobs",
    "thought_attempt_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(db, "operational_jobs", "next_thought_attempt_at_ms", "INTEGER");
  addColumnIfMissing(db, "operational_jobs", "last_thought_error_class", "TEXT");
  addColumnIfMissing(db, "operational_jobs", "cognition_expires_at_ms", "INTEGER");
  addColumnIfMissing(db, "operational_jobs", "normalized_thought_json", "TEXT");
  addColumnIfMissing(
    db,
    "operational_jobs",
    "normalized_thought_schema_version",
    "INTEGER",
  );
  addColumnIfMissing(db, "operational_jobs", "thought_attention_request_id", "INTEGER");
  addColumnIfMissing(db, "operational_jobs", "thought_attention_attempt_ids_json", "TEXT");
  db.exec(MIGRATION_34_DURABLE_COGNITION_DDL);
}

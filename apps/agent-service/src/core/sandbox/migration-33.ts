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

export const MIGRATION_33_OPERATIONAL_JOBS_DDL = `
CREATE TABLE IF NOT EXISTS operational_jobs (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid                 TEXT NOT NULL,
  data_classification         TEXT NOT NULL DEFAULT 'never_public',
  job_id                      TEXT NOT NULL,
  owner_id                    TEXT NOT NULL,
  source_message_entity_uuid  TEXT NOT NULL,
  source_user_message_id      INTEGER,
  admission_reservation_id    INTEGER NOT NULL,
  bounded_operation_task_id   TEXT,
  project_id                  TEXT,
  status                      TEXT NOT NULL
    CHECK (status IN (
      'admitted',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'deadline_exceeded',
      'outcome_unknown'
    )),
  cancel_requested            INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  cancel_requested_at         TEXT,
  current_step_index          INTEGER NOT NULL DEFAULT 0,
  lifetime_expires_at_ms      INTEGER NOT NULL,
  runner_owner_token          TEXT,
  runner_lease_generation     INTEGER NOT NULL DEFAULT 0,
  runner_lease_until_ms       INTEGER,
  stop_reason                 TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (job_id),
  UNIQUE (entity_uuid),
  UNIQUE (owner_id, source_message_entity_uuid)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_jobs_entity_uuid
  ON operational_jobs (entity_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_jobs_bounded_operation_task
  ON operational_jobs (bounded_operation_task_id)
  WHERE bounded_operation_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_jobs_owner_status
  ON operational_jobs (owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_operational_jobs_lease
  ON operational_jobs (status, runner_lease_until_ms);

CREATE TABLE IF NOT EXISTS operational_job_deliveries (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid              TEXT NOT NULL,
  data_classification      TEXT NOT NULL DEFAULT 'never_public',
  job_id                   TEXT NOT NULL,
  delivery_kind            TEXT NOT NULL CHECK (delivery_kind IN ('ack', 'completion')),
  delivery_reservation_id  INTEGER NOT NULL,
  created_at               TEXT NOT NULL,
  UNIQUE (entity_uuid),
  UNIQUE (job_id, delivery_kind)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_job_deliveries_entity_uuid
  ON operational_job_deliveries (entity_uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_job_deliveries_kind
  ON operational_job_deliveries (job_id, delivery_kind);

CREATE TABLE IF NOT EXISTS verification_receipts (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid              TEXT NOT NULL,
  data_classification      TEXT NOT NULL DEFAULT 'never_public',
  owner_id                 TEXT NOT NULL,
  task_id                  TEXT NOT NULL,
  workspace_id             TEXT NOT NULL,
  recipe_id                TEXT NOT NULL,
  recipe_version           TEXT,
  snapshot_id              TEXT,
  candidate_tree_hash      TEXT,
  base_tree_hash           TEXT,
  outcome                  TEXT NOT NULL,
  settled_at               TEXT NOT NULL,
  facts_json               TEXT NOT NULL DEFAULT '{}',
  UNIQUE (entity_uuid),
  UNIQUE (task_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_receipts_task
  ON verification_receipts (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_receipts_entity_uuid
  ON verification_receipts (entity_uuid);
`;

/** Nuclear v33 — durable operational-job envelope wrapping M6. No new effect class. */
export function ensureNuclearV33Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_33_OPERATIONAL_JOBS_DDL);
  addColumnIfMissing(db, "bounded_operation_tasks", "origin_job_id", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "child_task_id", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "causation_key", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "step_run_status", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "declared_at", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "started_at", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "settled_at", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "declared_lease_generation", "INTEGER");
  addColumnIfMissing(db, "bounded_operation_steps", "effect_ref_kind", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "effect_ref_id", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "effect_facts_json", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "derived_license_json", "TEXT");
  addColumnIfMissing(db, "bounded_operation_steps", "derived_license_schema_version", "INTEGER");
  addColumnIfMissing(db, "candidate_changesets", "origin_child_task_id", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_operation_tasks_origin_job
      ON bounded_operation_tasks (origin_job_id)
      WHERE origin_job_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_operation_steps_child_task
      ON bounded_operation_steps (child_task_id)
      WHERE child_task_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_operation_steps_causation
      ON bounded_operation_steps (causation_key)
      WHERE causation_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_changesets_origin_child
      ON candidate_changesets (origin_child_task_id)
      WHERE origin_child_task_id IS NOT NULL;
  `);
}

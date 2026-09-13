import type { DatabaseSync } from "node:sqlite";

/** Nuclear schema v32 — M7 patch_export control plane (named border copy only). */
export const MIGRATION_32_PATCH_EXPORT_DDL = `
CREATE TABLE IF NOT EXISTS patch_export_records (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid              TEXT NOT NULL,
  data_classification      TEXT NOT NULL DEFAULT 'never_public',
  owner_id                 TEXT NOT NULL,
  task_id                  TEXT NOT NULL,
  project_id               TEXT NOT NULL,
  changeset_id             TEXT NOT NULL,
  artifact_ref             TEXT NOT NULL,
  destination_path         TEXT NOT NULL,
  expected_sha256          TEXT NOT NULL,
  witness_sha256           TEXT,
  bytes_written            INTEGER,
  status                   TEXT NOT NULL
    CHECK (status IN (
      'succeeded',
      'failed',
      'outcome_unknown'
    )),
  error_code               TEXT,
  applied                  INTEGER NOT NULL DEFAULT 0 CHECK (applied = 0),
  live_unwritten           INTEGER NOT NULL DEFAULT 1 CHECK (live_unwritten = 1),
  git_unwritten            INTEGER NOT NULL DEFAULT 1 CHECK (git_unwritten = 1),
  created_at               TEXT NOT NULL,
  completed_at             TEXT,
  UNIQUE (task_id),
  UNIQUE (entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_patch_export_records_owner_status
  ON patch_export_records (owner_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patch_export_records_entity_uuid
  ON patch_export_records (entity_uuid);
CREATE INDEX IF NOT EXISTS idx_patch_export_records_changeset
  ON patch_export_records (changeset_id, created_at);
`;

export function ensureNuclearV32Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_32_PATCH_EXPORT_DDL);
}

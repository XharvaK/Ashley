import type { DatabaseSync } from "node:sqlite";

/** Nuclear schema v31 — M6 bounded-operation control plane (no new effect class). */
export const MIGRATION_31_BOUNDED_OPERATION_DDL = `
CREATE TABLE IF NOT EXISTS bounded_operation_tasks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid              TEXT NOT NULL,
  data_classification      TEXT NOT NULL DEFAULT 'never_public',
  owner_id                 TEXT NOT NULL,
  task_id                  TEXT NOT NULL,
  project_id               TEXT NOT NULL,
  workspace_id             TEXT NOT NULL,
  origin                   TEXT NOT NULL
    CHECK (origin IN ('owner_request', 'ashley_private_interest')),
  objective                TEXT NOT NULL,
  success_condition        TEXT NOT NULL,
  failure_condition        TEXT NOT NULL,
  admitted_steps_json      TEXT NOT NULL,
  max_steps                INTEGER NOT NULL,
  deadline_at_ms           INTEGER NOT NULL,
  status                   TEXT NOT NULL
    CHECK (status IN (
      'admitted',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'deadline_exceeded',
      'interrupted',
      'outcome_unknown'
    )),
  stop_reason              TEXT,
  steps_executed           INTEGER NOT NULL DEFAULT 0,
  cancel_requested         INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  border_state             TEXT NOT NULL DEFAULT 'none' CHECK (border_state = 'none'),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (task_id),
  UNIQUE (entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_bounded_operation_tasks_owner_status
  ON bounded_operation_tasks (owner_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_operation_tasks_entity_uuid
  ON bounded_operation_tasks (entity_uuid);

CREATE TABLE IF NOT EXISTS bounded_operation_steps (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid         TEXT NOT NULL,
  data_classification TEXT NOT NULL DEFAULT 'never_public',
  owner_id            TEXT NOT NULL,
  task_id             TEXT NOT NULL,
  step_index          INTEGER NOT NULL,
  step_kind           TEXT NOT NULL,
  operation           TEXT,
  outcome             TEXT NOT NULL
    CHECK (outcome IN ('succeeded', 'failed', 'skipped')),
  error               TEXT,
  recorded_at         TEXT NOT NULL,
  UNIQUE (entity_uuid),
  UNIQUE (task_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_bounded_operation_steps_task
  ON bounded_operation_steps (task_id, step_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_operation_steps_entity_uuid
  ON bounded_operation_steps (entity_uuid);
`;

export function ensureNuclearV31Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_31_BOUNDED_OPERATION_DDL);
}

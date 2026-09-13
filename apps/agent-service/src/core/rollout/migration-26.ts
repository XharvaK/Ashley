/** Nuclear schema v26 — Recall qualification epoch registry. */
export const MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL = `
CREATE TABLE IF NOT EXISTS recall_qualification_epochs (
  epoch_id                TEXT PRIMARY KEY NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('current', 'retired')),
  start_request_key       TEXT NOT NULL UNIQUE,
  predecessor_epoch_id    TEXT,
  contract_id             TEXT NOT NULL,
  started_build_identity  TEXT NOT NULL,
  created_by              TEXT NOT NULL,
  started_at              TEXT NOT NULL,
  retired_at              TEXT,
  eval_seed_count         INTEGER NOT NULL DEFAULT 0 CHECK (eval_seed_count >= 0),
  qualified_at            TEXT,
  model_epoch             INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recall_qualification_epochs_single_current
  ON recall_qualification_epochs (status) WHERE status = 'current';

CREATE TABLE IF NOT EXISTS recall_qualification_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch_id       TEXT NOT NULL REFERENCES recall_qualification_epochs(epoch_id),
  kind           TEXT NOT NULL CHECK (kind IN ('isolated_eval', 'live_shadow')),
  source_key     TEXT NOT NULL,
  detail_json    TEXT NOT NULL DEFAULT '{}',
  occurred_at    TEXT NOT NULL,
  build_identity TEXT NOT NULL,
  model_epoch    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (epoch_id, kind, source_key)
);
CREATE INDEX IF NOT EXISTS idx_recall_qualification_events_epoch
  ON recall_qualification_events (epoch_id, kind, occurred_at);
`;

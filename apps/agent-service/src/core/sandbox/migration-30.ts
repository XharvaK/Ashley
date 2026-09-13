import type { DatabaseSync } from "node:sqlite";

/** Nuclear schema v30 — M5 candidate change-set control plane (advisory only). */
export const MIGRATION_30_CANDIDATE_CHANGESET_DDL = `
CREATE TABLE IF NOT EXISTS candidate_changesets (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid              TEXT NOT NULL,
  data_classification      TEXT NOT NULL DEFAULT 'never_public',
  owner_id                 TEXT NOT NULL,
  changeset_id             TEXT NOT NULL,
  changeset_version        INTEGER NOT NULL DEFAULT 1 CHECK (changeset_version = 1),
  project_id               TEXT NOT NULL,
  workspace_id             TEXT NOT NULL,
  source_snapshot_id       TEXT NOT NULL,
  candidate_snapshot_id    TEXT,
  candidate_tree_hash      TEXT,
  base_tree_hash           TEXT,
  base_commit              TEXT,
  source_cleanliness       TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_cleanliness IN ('clean', 'dirty_explicit_manifest', 'unknown')),
  stale_base               INTEGER NOT NULL DEFAULT 0 CHECK (stale_base IN (0, 1)),
  tree_hash_algorithm      TEXT,
  objective                TEXT NOT NULL,
  rationale                TEXT NOT NULL,
  target_area              TEXT,
  expected_effect          TEXT,
  risk_class               TEXT NOT NULL
    CHECK (risk_class IN ('low', 'medium', 'high', 'consultation')),
  evidence_refs_json       TEXT NOT NULL DEFAULT '[]',
  verification_recipe_ids_json TEXT NOT NULL DEFAULT '[]',
  intended_paths_json      TEXT,
  changed_paths_json       TEXT,
  linked_verification_refs_json TEXT NOT NULL DEFAULT '[]',
  patch_sha256             TEXT,
  patch_bytes              INTEGER,
  artifact_ref             TEXT,
  status                   TEXT NOT NULL
    CHECK (status IN ('proposed', 'quarantined', 'stale_base', 'superseded', 'abandoned')),
  review_status            TEXT
    CHECK (review_status IS NULL OR review_status = 'submitted'),
  quarantine_reason        TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (changeset_id),
  UNIQUE (entity_uuid),
  CHECK (status != 'proposed' OR review_status = 'submitted'),
  CHECK (status != 'quarantined' OR quarantine_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_candidate_changesets_owner_status
  ON candidate_changesets (owner_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_changesets_entity_uuid
  ON candidate_changesets (entity_uuid);

CREATE TABLE IF NOT EXISTS candidate_changeset_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid         TEXT NOT NULL,
  data_classification TEXT NOT NULL DEFAULT 'never_public',
  owner_id            TEXT NOT NULL,
  changeset_id        TEXT NOT NULL,
  event_type          TEXT NOT NULL
    CHECK (event_type IN ('created', 'sealed', 'proposed', 'secret_quarantined')),
  metadata_json       TEXT NOT NULL DEFAULT '{}',
  recorded_at         TEXT NOT NULL,
  UNIQUE (entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_candidate_changeset_events_changeset
  ON candidate_changeset_events (changeset_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_changeset_events_entity_uuid
  ON candidate_changeset_events (entity_uuid);
`;

export function ensureNuclearV30Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_30_CANDIDATE_CHANGESET_DDL);
}

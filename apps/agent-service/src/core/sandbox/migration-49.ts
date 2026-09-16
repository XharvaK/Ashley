import type { DatabaseSync } from "node:sqlite";

const VERIFICATION_FAILED_STATUS = "'verification_failed'";

/** Nuclear schema v49 — record the verified candidate that failed mechanically. */
export const MIGRATION_49_NUCLEAR_DDL = `
DROP INDEX IF EXISTS idx_candidate_changesets_origin_child;
DROP INDEX IF EXISTS idx_candidate_changesets_entity_uuid;
DROP INDEX IF EXISTS idx_candidate_changesets_owner_status;
DROP INDEX IF EXISTS idx_candidate_changeset_events_entity_uuid;
DROP INDEX IF EXISTS idx_candidate_changeset_events_changeset;

ALTER TABLE candidate_changesets RENAME TO candidate_changesets_v48;
ALTER TABLE candidate_changeset_events RENAME TO candidate_changeset_events_v48;

CREATE TABLE candidate_changesets (
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
    CHECK (status IN ('proposed', 'quarantined', 'stale_base', 'superseded', 'abandoned', ${VERIFICATION_FAILED_STATUS})),
  review_status            TEXT
    CHECK (review_status IS NULL OR review_status = 'submitted'),
  quarantine_reason        TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  origin_child_task_id     TEXT,
  UNIQUE (changeset_id),
  UNIQUE (entity_uuid),
  CHECK (status != 'proposed' OR review_status = 'submitted'),
  CHECK (status != 'quarantined' OR quarantine_reason IS NOT NULL)
);

INSERT INTO candidate_changesets (
  id, entity_uuid, data_classification, owner_id, changeset_id,
  changeset_version, project_id, workspace_id, source_snapshot_id,
  candidate_snapshot_id, candidate_tree_hash, base_tree_hash, base_commit,
  source_cleanliness, stale_base, tree_hash_algorithm, objective, rationale,
  target_area, expected_effect, risk_class, evidence_refs_json,
  verification_recipe_ids_json, intended_paths_json, changed_paths_json,
  linked_verification_refs_json, patch_sha256, patch_bytes, artifact_ref,
  status, review_status, quarantine_reason, created_at, updated_at,
  origin_child_task_id
)
SELECT
  id, entity_uuid, data_classification, owner_id, changeset_id,
  changeset_version, project_id, workspace_id, source_snapshot_id,
  candidate_snapshot_id, candidate_tree_hash, base_tree_hash, base_commit,
  source_cleanliness, stale_base, tree_hash_algorithm, objective, rationale,
  target_area, expected_effect, risk_class, evidence_refs_json,
  verification_recipe_ids_json, intended_paths_json, changed_paths_json,
  linked_verification_refs_json, patch_sha256, patch_bytes, artifact_ref,
  status, review_status, quarantine_reason, created_at, updated_at,
  origin_child_task_id
FROM candidate_changesets_v48;

CREATE TABLE candidate_changeset_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid         TEXT NOT NULL,
  data_classification TEXT NOT NULL DEFAULT 'never_public',
  owner_id            TEXT NOT NULL,
  changeset_id        TEXT NOT NULL,
  event_type          TEXT NOT NULL
    CHECK (event_type IN ('created', 'sealed', 'proposed', 'secret_quarantined', 'verification_failed')),
  metadata_json       TEXT NOT NULL DEFAULT '{}',
  recorded_at         TEXT NOT NULL,
  UNIQUE (entity_uuid)
);

INSERT INTO candidate_changeset_events (
  id, entity_uuid, data_classification, owner_id, changeset_id,
  event_type, metadata_json, recorded_at
)
SELECT
  id, entity_uuid, data_classification, owner_id, changeset_id,
  event_type, metadata_json, recorded_at
FROM candidate_changeset_events_v48;

DROP TABLE candidate_changeset_events_v48;
DROP TABLE candidate_changesets_v48;

CREATE INDEX idx_candidate_changesets_owner_status
  ON candidate_changesets (owner_id, status, created_at);
CREATE UNIQUE INDEX idx_candidate_changesets_entity_uuid
  ON candidate_changesets (entity_uuid);
CREATE UNIQUE INDEX idx_candidate_changesets_origin_child
  ON candidate_changesets (origin_child_task_id)
  WHERE origin_child_task_id IS NOT NULL;
CREATE INDEX idx_candidate_changeset_events_changeset
  ON candidate_changeset_events (changeset_id, recorded_at);
CREATE UNIQUE INDEX idx_candidate_changeset_events_entity_uuid
  ON candidate_changeset_events (entity_uuid);
`;

function tableSql(db: DatabaseSync, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: unknown } | undefined;
  return String(row?.sql ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasV49Checks(db: DatabaseSync): boolean {
  return tableSql(db, "candidate_changesets").includes(
    "'verification_failed'",
  ) && tableSql(db, "candidate_changeset_events").includes(
    "'verification_failed'",
  );
}

/** Idempotent installer used by v49 fixtures and recovery paths. */
export function ensureNuclearV49Schema(db: DatabaseSync): void {
  if (hasV49Checks(db)) return;
  db.exec(MIGRATION_49_NUCLEAR_DDL);
}

function requireTableFragment(db: DatabaseSync, table: string, fragment: string, version: number): void {
  if (!tableSql(db, table).includes(fragment)) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:table_constraint:${table}`);
  }
}

function requireIndex(db: DatabaseSync, name: string, version: number): void {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name);
  if (!row) throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:${name}`);
}

export function validateNuclearV49Schema(db: DatabaseSync, version = 49): void {
  requireTableFragment(
    db,
    "candidate_changesets",
    "check (status in ('proposed', 'quarantined', 'stale_base', 'superseded', 'abandoned', 'verification_failed'))",
    version,
  );
  requireTableFragment(
    db,
    "candidate_changeset_events",
    "check (event_type in ('created', 'sealed', 'proposed', 'secret_quarantined', 'verification_failed'))",
    version,
  );
  for (const index of [
    "idx_candidate_changesets_owner_status",
    "idx_candidate_changesets_entity_uuid",
    "idx_candidate_changesets_origin_child",
    "idx_candidate_changeset_events_changeset",
    "idx_candidate_changeset_events_entity_uuid",
  ]) {
    requireIndex(db, index, version);
  }
}

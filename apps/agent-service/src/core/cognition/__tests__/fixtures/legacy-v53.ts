// Historical v53 objects captured at 5996032; test fixtures only.
import type { DatabaseSync } from "node:sqlite";
const objects = [
  {
    "type": "table",
    "name": "context_allocation_receipts",
    "tbl_name": "context_allocation_receipts",
    "sql": "CREATE TABLE context_allocation_receipts (\n  receipt_id TEXT PRIMARY KEY,\n  request_id TEXT NOT NULL,\n  owner_id TEXT NOT NULL,\n  purpose TEXT NOT NULL,\n  route_policy_snapshot_id TEXT NOT NULL,\n  route_id TEXT NOT NULL,\n  profile_id TEXT NOT NULL,\n  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),\n  profile_fingerprint TEXT NOT NULL,\n  provider_adapter_class TEXT NOT NULL,\n  egress_approval_ref TEXT,\n  route_class TEXT NOT NULL CHECK (route_class IN (\n    'remote_companion', 'local', 'public_surface', 'unknown'\n  )),\n  policy_id TEXT NOT NULL,\n  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),\n  projection_id TEXT NOT NULL UNIQUE,\n  content_binding TEXT NOT NULL,\n  included_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(included_json)),\n  omitted_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(omitted_json)),\n  truncated_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(truncated_json)),\n  compressed_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(compressed_json)),\n  degradation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(degradation_json)),\n  same_snapshot_id TEXT,\n  capability_mode TEXT NOT NULL CHECK (capability_mode IN (\n    'observe', 'dark_apply', 'apply'\n  )),\n  created_at TEXT NOT NULL\n)"
  },
  {
    "type": "table",
    "name": "context_budget_policies",
    "tbl_name": "context_budget_policies",
    "sql": "CREATE TABLE context_budget_policies (\n  policy_id TEXT NOT NULL,\n  version INTEGER NOT NULL CHECK (version >= 1),\n  total_utf8_bytes INTEGER NOT NULL CHECK (total_utf8_bytes > 0),\n  section_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(section_json)),\n  token_estimate_divisor INTEGER NOT NULL DEFAULT 4\n    CHECK (token_estimate_divisor >= 1),\n  created_at TEXT NOT NULL,\n  PRIMARY KEY (policy_id, version)\n)"
  },
  {
    "type": "table",
    "name": "context_summary_projections",
    "tbl_name": "context_summary_projections",
    "sql": "CREATE TABLE context_summary_projections (\n  summary_id TEXT PRIMARY KEY,\n  owner_id TEXT NOT NULL,\n  policy_id TEXT NOT NULL,\n  mechanism TEXT NOT NULL CHECK (mechanism IN (\n    'deterministic_extract', 'utility_model'\n  )),\n  created_at TEXT NOT NULL,\n  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),\n  source_content_binding TEXT NOT NULL,\n  classification TEXT NOT NULL CHECK (classification IN (\n    'ordinary', 'sensitive', 'never_public'\n  )),\n  text_utf8 TEXT NOT NULL,\n  limitations_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limitations_json)),\n  invalidated_at TEXT,\n  invalidation_reason TEXT\n)"
  },
  {
    "type": "table",
    "name": "identity_reviews",
    "tbl_name": "identity_reviews",
    "sql": "CREATE TABLE identity_reviews (\n  id                   INTEGER PRIMARY KEY AUTOINCREMENT,\n  owner_id             TEXT NOT NULL,\n  revision_id          INTEGER NOT NULL UNIQUE REFERENCES learning_revisions(id),\n  target_kind          TEXT NOT NULL CHECK (target_kind IN ('value', 'boundary')),\n  ashley_position      TEXT CHECK (ashley_position IN ('affirm', 'object', 'defer')),\n  ashley_rationale     TEXT,\n  ashley_evidence_type TEXT,\n  ashley_evidence_id   TEXT,\n  ashley_decided_at    TEXT,\n  doc_decision         TEXT CHECK (doc_decision IN ('approve', 'reject', 'defer')),\n  doc_rationale        TEXT,\n  doc_decided_at       TEXT,\n  applied_at           TEXT,\n  created_at           TEXT NOT NULL,\n  updated_at           TEXT NOT NULL\n)"
  },
  {
    "type": "table",
    "name": "learning_revisions",
    "tbl_name": "learning_revisions",
    "sql": "CREATE TABLE learning_revisions (\n  id             INTEGER PRIMARY KEY AUTOINCREMENT,\n  owner_id       TEXT NOT NULL,\n  target_layer   TEXT NOT NULL CHECK (target_layer IN (\n                   'dynamic_identity', 'stable_identity', 'opinion'\n                 )),\n  target_key     TEXT NOT NULL,\n  previous_value TEXT,\n  proposed_value TEXT NOT NULL,\n  rationale      TEXT NOT NULL,\n  status         TEXT NOT NULL DEFAULT 'proposed'\n                   CHECK (status IN ('proposed', 'applied', 'reverted', 'rejected')),\n  apply_after    TEXT NOT NULL,\n  applied_at     TEXT,\n  reverted_at    TEXT,\n  created_at     TEXT NOT NULL,\n  updated_at     TEXT NOT NULL\n, applied_target_id INTEGER, entity_uuid TEXT, data_classification TEXT, provenance TEXT NOT NULL DEFAULT 'shadow'\n  CHECK (provenance IN ('shadow', 'live')))"
  },
  {
    "type": "table",
    "name": "lived_experience_links",
    "tbl_name": "lived_experience_links",
    "sql": "CREATE TABLE lived_experience_links (\n  id TEXT PRIMARY KEY,\n  owner_id TEXT NOT NULL,\n  episode_id INTEGER REFERENCES episodes(id),\n  prediction_id INTEGER REFERENCES cognitive_predictions(id),\n  operational_ref TEXT NOT NULL CHECK (length(trim(operational_ref)) BETWEEN 1 AND 200),\n  reflection_event_id INTEGER REFERENCES reflection_events(id),\n  revision_id INTEGER REFERENCES learning_revisions(id),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),\n  validity_state TEXT NOT NULL DEFAULT 'active' CHECK (validity_state IN (\n    'active', 'invalidated'\n  )),\n  invalidated_at TEXT,\n  created_at TEXT NOT NULL,\n  CHECK (episode_id IS NOT NULL OR prediction_id IS NOT NULL)\n)"
  },
  {
    "type": "index",
    "name": "idx_context_allocation_receipts_owner_created",
    "tbl_name": "context_allocation_receipts",
    "sql": "CREATE INDEX idx_context_allocation_receipts_owner_created\n  ON context_allocation_receipts (owner_id, created_at)"
  },
  {
    "type": "index",
    "name": "idx_context_allocation_receipts_policy",
    "tbl_name": "context_allocation_receipts",
    "sql": "CREATE INDEX idx_context_allocation_receipts_policy\n  ON context_allocation_receipts (policy_id, policy_version, created_at)"
  },
  {
    "type": "index",
    "name": "idx_context_allocation_receipts_request",
    "tbl_name": "context_allocation_receipts",
    "sql": "CREATE INDEX idx_context_allocation_receipts_request\n  ON context_allocation_receipts (request_id, created_at)"
  },
  {
    "type": "index",
    "name": "idx_context_summary_projections_owner",
    "tbl_name": "context_summary_projections",
    "sql": "CREATE INDEX idx_context_summary_projections_owner\n  ON context_summary_projections (owner_id, created_at)"
  },
  {
    "type": "index",
    "name": "idx_identity_reviews_owner",
    "tbl_name": "identity_reviews",
    "sql": "CREATE INDEX idx_identity_reviews_owner\n  ON identity_reviews (owner_id, applied_at, updated_at DESC, id DESC)"
  },
  {
    "type": "index",
    "name": "idx_learning_revisions_entity_uuid",
    "tbl_name": "learning_revisions",
    "sql": "CREATE UNIQUE INDEX idx_learning_revisions_entity_uuid\n       ON learning_revisions (entity_uuid)"
  },
  {
    "type": "index",
    "name": "idx_learning_revisions_owner",
    "tbl_name": "learning_revisions",
    "sql": "CREATE INDEX idx_learning_revisions_owner\n  ON learning_revisions (owner_id, status, target_layer, target_key, created_at DESC)"
  },
  {
    "type": "index",
    "name": "idx_learning_revisions_provenance",
    "tbl_name": "learning_revisions",
    "sql": "CREATE INDEX idx_learning_revisions_provenance\n  ON learning_revisions (owner_id, provenance, status, id DESC)"
  },
  {
    "type": "index",
    "name": "idx_lived_experience_links_owner_created",
    "tbl_name": "lived_experience_links",
    "sql": "CREATE INDEX idx_lived_experience_links_owner_created\n  ON lived_experience_links (owner_id, created_at, id)"
  }
];

export function restoreLegacyV53Objects(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  for (const object of objects) {
    if (object.tbl_name === "lived_experience_links" && object.type === "table") db.exec("DROP TABLE lived_experience_links");
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(object.name);
    if (!exists) db.exec(object.sql);
  }
  db.exec("PRAGMA foreign_keys = ON");
}

export const MIGRATION_16_CHANGE_PROPOSAL_DDL = `
CREATE TABLE IF NOT EXISTS change_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  proposer TEXT NOT NULL CHECK (proposer IN ('ashley', 'operator')),
  capability_contract_id TEXT,
  capability_contract_hash TEXT,
  target_category TEXT NOT NULL CHECK (target_category IN (
    'runtime_code', 'prompt_expression', 'ordinary_identity', 'foundational_identity',
    'ethics_governance', 'capability_policy', 'evaluation', 'vision'
  )),
  target_refs_json TEXT NOT NULL DEFAULT '[]',
  objective TEXT NOT NULL,
  rationale TEXT NOT NULL,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high', 'consultation')),
  data_classification TEXT NOT NULL,
  retention_class TEXT NOT NULL DEFAULT 'proposal_audit',
  retention_expires_at TEXT,
  base_commit TEXT,
  base_tree_hash TEXT,
  base_capture_at TEXT,
  repository_identity TEXT,
  source_cleanliness TEXT CHECK (source_cleanliness IN ('clean', 'dirty_blocked', 'dirty_explicit_manifest')),
  base_stale INTEGER NOT NULL DEFAULT 0,
  source_archive_manifest_ref TEXT,
  source_archive_segment_refs_json TEXT NOT NULL DEFAULT '[]',
  source_archive_aggregate_hash TEXT,
  source_archive_bytes INTEGER NOT NULL DEFAULT 0,
  excluded_path_count INTEGER NOT NULL DEFAULT 0,
  patch_artifact_ref TEXT,
  patch_entity_uuid TEXT,
  summary_artifact_ref TEXT,
  test_receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  consultation_required INTEGER NOT NULL DEFAULT 0,
  consultation_clause TEXT,
  ashley_position TEXT CHECK (ashley_position IN ('affirm', 'object', 'defer')),
  ashley_rationale TEXT,
  ashley_decided_at TEXT,
  doc_decision TEXT CHECK (doc_decision IN ('approve', 'reject', 'defer')),
  doc_rationale TEXT,
  doc_decided_at TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'draft', 'proposed', 'awaiting_ashley_position', 'awaiting_doc_decision',
    'approved', 'rejected', 'deferred', 'expired', 'stale_base', 'quarantined', 'superseded'
  )),
  linked_revision_entity_uuid TEXT,
  linked_identity_review_entity_uuid TEXT,
  external_outcome TEXT CHECK (external_outcome IN ('committed', 'deployed', 'abandoned')),
  external_outcome_at TEXT,
  external_outcome_note TEXT,
  quarantine_reason TEXT CHECK (quarantine_reason IN ('secret_detected', 'patch_unsafe', 'archive_too_large')),
  quarantined_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_proposals_owner_state
  ON change_proposals (owner_id, state);
CREATE INDEX IF NOT EXISTS idx_change_proposals_proposal_id
  ON change_proposals (proposal_id);

CREATE TABLE IF NOT EXISTS change_proposal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  proposal_entity_uuid TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  data_classification TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_entity_uuid) REFERENCES change_proposals(entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_change_proposal_events_proposal
  ON change_proposal_events (proposal_entity_uuid, created_at);
`;

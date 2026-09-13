/**
 * Nuclear schema v19 — sandbox owner approval proposals (Sandbox Wave 4,
 * Commit 11). Records are owner-scoped, immutable-in-bindings, and targetable
 * (entity_uuid + data_classification via the v13 machinery).
 */

export const MIGRATION_19_SANDBOX_APPROVAL_DDL = `
CREATE TABLE IF NOT EXISTS sandbox_approval_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL UNIQUE,
  task_id TEXT,
  session_uuid TEXT,
  capability_id TEXT NOT NULL,
  authoritative_risk_class TEXT NOT NULL CHECK (authoritative_risk_class IN (
    'low', 'medium', 'high', 'consultation'
  )),
  affected_paths_json TEXT NOT NULL DEFAULT '[]',
  policy_rule_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_hash TEXT NOT NULL,
  recipe_id TEXT,
  executable_id TEXT,
  persistence TEXT NOT NULL CHECK (persistence IN ('temporary', 'persistent')),
  requires_network INTEGER NOT NULL DEFAULT 0,
  external_side_effect INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT,
  model_summary TEXT,
  source TEXT NOT NULL CHECK (source IN ('policy_precheck', 'model_claim')),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'approved', 'rejected', 'withdrawn', 'stale', 'expired'
  )),
  decision_reason TEXT,
  data_classification TEXT NOT NULL DEFAULT 'sandbox_approval_metadata',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at_ms INTEGER,
  expires_at TEXT NOT NULL,
  envelope_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sandbox_approvals_owner_status
  ON sandbox_approval_proposals (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_sandbox_approvals_session
  ON sandbox_approval_proposals (session_uuid);

CREATE TABLE IF NOT EXISTS sandbox_approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  proposal_entity_uuid TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  data_classification TEXT NOT NULL DEFAULT 'sandbox_approval_metadata',
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_entity_uuid)
    REFERENCES sandbox_approval_proposals(entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_sandbox_approval_events_proposal
  ON sandbox_approval_events (proposal_entity_uuid, created_at);
`;

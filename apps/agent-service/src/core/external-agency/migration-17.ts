export const MIGRATION_17_EXTERNAL_AGENCY_DDL = `
CREATE TABLE IF NOT EXISTS external_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  account_ref TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'read', 'draft', 'send_private', 'send_public', 'observe', 'prepare'
  )),
  risk_class TEXT NOT NULL CHECK (risk_class IN (
    'observe', 'prepare', 'reversible_private', 'public', 'irreversible'
  )),
  data_classification TEXT NOT NULL,
  retention_class TEXT NOT NULL DEFAULT 'external_action_audit',
  retention_expires_at TEXT,
  policy_authorization_ref TEXT,
  owner_approval_ref TEXT,
  policy_decision_hash TEXT,
  policy_contract_id TEXT,
  policy_contract_hash TEXT,
  capability_contract_hash TEXT,
  capability_release_id TEXT,
  evaluator_build_id TEXT,
  payload_ref TEXT,
  payload_hash TEXT,
  payload_classification TEXT,
  classification_inputs_hash TEXT,
  thought_authorization_refs_json TEXT NOT NULL DEFAULT '[]',
  public_disclosure_result_hash TEXT,
  credential_ref TEXT,
  credential_lineage_ref TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'drafted', 'policy_checked', 'policy_denied', 'reserved', 'dispatching',
    'receipt_received', 'committed', 'partially_delivered', 'aborted',
    'cancelled', 'expired', 'reconciliation_required', 'reconciliation_expired',
    'outcome_unknown'
  )),
  idempotency_key TEXT NOT NULL,
  terminal_reason TEXT,
  reconciliation_state TEXT,
  reconciliation_ref TEXT,
  reconciliation_lease_expires_at TEXT,
  provider_receipt_ids_json TEXT NOT NULL DEFAULT '[]',
  provider_message_ids_json TEXT NOT NULL DEFAULT '[]',
  provider_attempt_id TEXT,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  planned_count INTEGER NOT NULL DEFAULT 0,
  reservation_expires_at TEXT,
  dispatch_lease_id TEXT,
  dispatch_lease_expires_at TEXT,
  external_erasure_scope_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_actions_owner_state
  ON external_actions (owner_id, state);
CREATE INDEX IF NOT EXISTS idx_external_actions_idempotency
  ON external_actions (owner_id, destination_id, idempotency_key);

CREATE TABLE IF NOT EXISTS external_action_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  action_entity_uuid TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  data_classification TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (action_entity_uuid) REFERENCES external_actions(entity_uuid)
);
CREATE INDEX IF NOT EXISTS idx_external_action_events_action
  ON external_action_events (action_entity_uuid, created_at);

CREATE TABLE IF NOT EXISTS external_entity_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  source_entity_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('private', 'public')),
  data_classification TEXT NOT NULL,
  retention_class TEXT NOT NULL DEFAULT 'external_entity_note',
  retention_expires_at TEXT,
  claims_json TEXT NOT NULL DEFAULT '[]',
  verified_facts_json TEXT NOT NULL DEFAULT '[]',
  ashley_opinion TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_entity_notes_owner
  ON external_entity_notes (owner_id, created_at);

CREATE TABLE IF NOT EXISTS vault_credential_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  credential_ref TEXT NOT NULL UNIQUE,
  credential_lineage_ref TEXT NOT NULL,
  destination_id TEXT,
  data_classification TEXT NOT NULL,
  retention_class TEXT NOT NULL DEFAULT 'vault_metadata',
  state TEXT NOT NULL CHECK (state IN ('active', 'revoked')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_credential_index_owner
  ON vault_credential_index (owner_id, state);

CREATE TABLE IF NOT EXISTS external_agency_state (
  owner_id TEXT PRIMARY KEY,
  emergency_stop INTEGER NOT NULL DEFAULT 0,
  emergency_stop_at TEXT,
  updated_at TEXT NOT NULL
);
`;

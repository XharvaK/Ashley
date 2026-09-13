export const MIGRATION_15_PERCEPTION_DDL = `
CREATE TABLE IF NOT EXISTS perception_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('discord_attachment')),
  discord_attachment_id TEXT NOT NULL,
  source_message_entity_uuid TEXT NOT NULL,
  delivery_reservation_entity_uuid TEXT NOT NULL,
  url_fingerprint TEXT NOT NULL,
  final_url_fingerprint TEXT,
  mime_declared TEXT,
  mime_detected TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  aggregate_turn_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'fetching', 'fetched', 'included', 'failed', 'unsupported', 'expired', 'redacted'
  )),
  error_code TEXT,
  model_representation TEXT NOT NULL DEFAULT 'none' CHECK (model_representation IN (
    'none', 'inline_base64', 'inline_text_excerpt'
  )),
  model_parts_json TEXT NOT NULL DEFAULT '[]',
  excerpt TEXT,
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (delivery_reservation_entity_uuid, discord_attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_perception_artifacts_owner_status
  ON perception_artifacts (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_perception_artifacts_reservation
  ON perception_artifacts (delivery_reservation_entity_uuid);

CREATE TABLE IF NOT EXISTS conversational_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  source_message_entity_uuid TEXT NOT NULL,
  delivery_reservation_entity_uuid TEXT NOT NULL,
  authorization_decision_entity_uuid TEXT,
  requested_url_fingerprint TEXT NOT NULL,
  final_url_fingerprint TEXT,
  content_hash TEXT,
  title TEXT,
  excerpt TEXT,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN (
    'read_record', 'fetch_failed', 'snippet_only'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'fetching', 'fetched', 'included', 'failed', 'expired', 'redacted'
  )),
  error_code TEXT,
  model_representation TEXT NOT NULL DEFAULT 'none' CHECK (model_representation IN (
    'none', 'inline_base64', 'inline_text_excerpt'
  )),
  model_parts_json TEXT NOT NULL DEFAULT '[]',
  retention_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversational_reads_owner_status
  ON conversational_reads (owner_id, status);
`;

export const MIGRATION_15_ATTENTION_PURPOSE = `
ALTER TABLE attention_requests RENAME TO attention_requests_v15;
CREATE TABLE attention_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL CHECK (lane IN (
    'interactive', 'urgent_grounded', 'exchange_cognition', 'curiosity_maintenance'
  )),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'expression', 'thought', 'thought_observation', 'exchange_cognition',
    'curiosity_consolidation', 'maintenance',
    'attachment_fetch', 'conversational_read'
  )),
  model_alias TEXT NOT NULL,
  resolved_model_id TEXT,
  model_epoch INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued', 'reserved', 'running', 'terminal')),
  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN (
      'completed', 'cancelled', 'timeout', 'rate_limited', 'error', 'aborted'
    )
  ),
  error_class TEXT,
  queued_at TEXT NOT NULL,
  eligible_at TEXT NOT NULL,
  age_origin_at TEXT NOT NULL,
  deadline_at TEXT,
  reserved_at TEXT,
  dispatch_started_at TEXT,
  ended_at TEXT,
  dispatch_sequence INTEGER,
  lease_expires_at TEXT,
  recovery_class TEXT,
  folded_at TEXT,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  budget_retain_until TEXT,
  delivery_reservation_id INTEGER,
  decision_id INTEGER,
  cognitive_job_id INTEGER,
  owner_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (state IN ('queued', 'reserved', 'running') AND outcome IS NULL)
    OR (state = 'terminal' AND outcome IS NOT NULL)
  )
);
INSERT INTO attention_requests
  (id, lane, purpose, model_alias, resolved_model_id, model_epoch, state, outcome,
   error_class, queued_at, eligible_at, age_origin_at, deadline_at, reserved_at,
   dispatch_started_at, ended_at, dispatch_sequence, lease_expires_at, recovery_class,
   folded_at, estimated_input_tokens, estimated_output_tokens, reserved_input_tokens,
   reserved_output_tokens, actual_input_tokens, actual_output_tokens,
   budget_retain_until, delivery_reservation_id, decision_id, cognitive_job_id,
   owner_id, created_at)
SELECT id, lane, purpose, model_alias, resolved_model_id, model_epoch, state, outcome,
       error_class, queued_at, eligible_at, age_origin_at, deadline_at, reserved_at,
       dispatch_started_at, ended_at, dispatch_sequence, lease_expires_at, recovery_class,
       folded_at, estimated_input_tokens, estimated_output_tokens, reserved_input_tokens,
       reserved_output_tokens, actual_input_tokens, actual_output_tokens,
       budget_retain_until, delivery_reservation_id, decision_id, cognitive_job_id,
       owner_id, created_at
FROM attention_requests_v15;
DROP TABLE attention_requests_v15;
CREATE INDEX IF NOT EXISTS idx_attention_requests_state_lane
  ON attention_requests (state, lane, eligible_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_dispatch_seq
  ON attention_requests (dispatch_sequence);
CREATE INDEX IF NOT EXISTS idx_attention_requests_folded
  ON attention_requests (folded_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_budget
  ON attention_requests (state, reserved_at, budget_retain_until);
`;

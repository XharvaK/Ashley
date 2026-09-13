CREATE TABLE IF NOT EXISTS cognitive_sidecar_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  architecture_epoch TEXT NOT NULL,
  implementation_spec_version TEXT NOT NULL,
  thought_contract_version INTEGER NOT NULL,
  authority_epoch INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS conversation_evidence_log (
  row_id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT,
  created_at_ms INTEGER NOT NULL,
  discord_message_ids_json TEXT NOT NULL,
  reservation_id INTEGER,
  producing_cycle_id TEXT,
  architecture_epoch TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_status TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  secret_omitted INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lineage_id, version)
);
CREATE INDEX IF NOT EXISTS idx_evidence_conversation_created
  ON conversation_evidence_log (conversation_id, created_at_ms);

CREATE TABLE IF NOT EXISTS conversation_evidence_discord_ids (
  discord_message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_discord_lineage
  ON conversation_evidence_discord_ids (lineage_id);

CREATE TABLE IF NOT EXISTS inbox_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  claim_token TEXT,
  worker_id TEXT,
  lease_expires_at_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at_ms INTEGER,
  consumed_at_ms INTEGER,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_pending
  ON inbox_events (conversation_id, created_at_ms)
  WHERE status IN ('pending', 'claimed', 'failed_retryable');

CREATE TABLE IF NOT EXISTS cycle_records (
  cycle_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  trigger_ref TEXT,
  occupant_id TEXT,
  authority_epoch INTEGER NOT NULL,
  architecture_epoch TEXT NOT NULL,
  admitted_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  compose_log_ids_json TEXT NOT NULL DEFAULT '[]',
  preempted_generation INTEGER
);

CREATE TABLE IF NOT EXISTS thought_steps (
  request_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  pass INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS working_context_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  superseded INTEGER NOT NULL DEFAULT 0,
  updated_cycle TEXT,
  updated_generation INTEGER
);

CREATE TABLE IF NOT EXISTS concerns (
  concern_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  assertion_key TEXT,
  status TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  updated_cycle TEXT
);

CREATE TABLE IF NOT EXISTS mind_occupancy (
  conversation_id TEXT NOT NULL,
  concern_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  updated_cycle TEXT NOT NULL,
  updated_generation INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, concern_id)
);

CREATE TABLE IF NOT EXISTS future_triggers (
  trigger_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  concern_id TEXT NOT NULL,
  due_at_ms INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS observation_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observations (
  observation_id TEXT PRIMARY KEY,
  cycle_id TEXT,
  generation INTEGER,
  derived INTEGER NOT NULL DEFAULT 0,
  replay_safe INTEGER NOT NULL DEFAULT 1,
  modality TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  raw_outranks_derived_of TEXT,
  data_classification TEXT NOT NULL,
  secret_omitted INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS speech_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id TEXT NOT NULL UNIQUE,
  projection_key TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  licensed_text TEXT NOT NULL,
  send_status TEXT NOT NULL,
  nuclear_reservation_id INTEGER,
  discord_message_ids_json TEXT NOT NULL DEFAULT '[]',
  suppressed INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  delivery_intent_json TEXT NOT NULL,
  nuclear_finalization_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_speech_outbox_nuclear_res
  ON speech_outbox (nuclear_reservation_id)
  WHERE nuclear_reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS system_notice_outbox (
  notice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_key TEXT NOT NULL UNIQUE,
  projection_key TEXT NOT NULL UNIQUE,
  cycle_id TEXT,
  conversation_id TEXT NOT NULL,
  notice_text TEXT NOT NULL,
  send_status TEXT NOT NULL,
  nuclear_reservation_id INTEGER,
  discord_message_id TEXT,
  origin TEXT NOT NULL,
  delivery_intent_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS in_flight_effects (
  effect_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dispatched_at_ms INTEGER,
  origin_job_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_in_flight_idempotency
  ON in_flight_effects (idempotency_key);

CREATE TABLE IF NOT EXISTS effect_receipts (
  receipt_id TEXT PRIMARY KEY,
  effect_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  data_classification TEXT NOT NULL,
  secret_omitted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_effect_receipts_effect
  ON effect_receipts (effect_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_effect_receipts_idempotency
  ON effect_receipts (idempotency_key);

CREATE TABLE IF NOT EXISTS durable_nominations (
  nomination_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  assertion_key TEXT NOT NULL,
  statement TEXT NOT NULL,
  memory_kind TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  supersedes_assertion_key TEXT,
  concern_id TEXT,
  admitted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sidecar_memory_assertions (
  assertion_key TEXT PRIMARY KEY,
  statement TEXT NOT NULL,
  memory_kind TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  lineage_parent_key TEXT,
  admitted_generation INTEGER,
  live INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sidecar_memory_supports (
  support_id TEXT PRIMARY KEY,
  assertion_key TEXT NOT NULL,
  source TEXT NOT NULL,
  provenance TEXT NOT NULL,
  source_architecture_epoch TEXT NOT NULL,
  source_ref TEXT,
  settlement_id TEXT,
  evidence_lineage_id TEXT,
  observation_id TEXT,
  receipt_id TEXT,
  dimensions_json TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_supports_key
  ON sidecar_memory_supports (assertion_key);

CREATE TABLE IF NOT EXISTS admission_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nomination_id TEXT NOT NULL,
  assertion_key TEXT NOT NULL,
  result TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (cycle_id, generation)
);

CREATE TABLE IF NOT EXISTS causal_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  thought_unavailable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS thought_attempt_counters (
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  thought_model_attempts INTEGER NOT NULL DEFAULT 0,
  accepted_thought_passes INTEGER NOT NULL DEFAULT 0,
  structural_retries INTEGER NOT NULL DEFAULT 0,
  compose_cancelled_attempts INTEGER NOT NULL DEFAULT 0,
  authority_revisions INTEGER NOT NULL DEFAULT 0,
  observation_rounds INTEGER NOT NULL DEFAULT 0,
  effect_rounds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, generation)
);

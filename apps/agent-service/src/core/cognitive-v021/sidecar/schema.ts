/** Complete sidecar schema v1. Keep this in sync with schema-v1.sql. */
export const COGNITIVE_SIDECAR_SCHEMA_V1_VERSION = 1 as const;

export const COGNITIVE_SIDECAR_SCHEMA_V1 = String.raw`
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
`;

export const COGNITIVE_SIDECAR_SCHEMA = COGNITIVE_SIDECAR_SCHEMA_V1;

export const COGNITIVE_SIDECAR_SCHEMA_V2 = String.raw`
ALTER TABLE cognitive_sidecar_meta ADD COLUMN projection_barrier_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cognitive_sidecar_meta ADD COLUMN projection_vector_json TEXT NOT NULL DEFAULT '{"nuclear":0,"continuity":0,"cognitive_sidecar":0}';
ALTER TABLE cognitive_sidecar_meta ADD COLUMN projection_state TEXT NOT NULL DEFAULT 'reconciling'
  CHECK (projection_state IN ('current', 'reconciling'));
UPDATE cognitive_sidecar_meta
   SET schema_version = 2,
       projection_vector_json = '{"nuclear":0,"continuity":0,"cognitive_sidecar":0}',
       projection_state = 'reconciling'
 WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V3 = String.raw`
CREATE TABLE wakes (
  wake_id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL UNIQUE,
  trigger_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('inbox','future_trigger','idle','subscription')),
  conversation_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','authorized','consequence_pending','reconciling','terminal')),
  terminal_reason TEXT CHECK (terminal_reason IS NULL OR terminal_reason IN ('completed','no_action','refused','cancelled','expired','quarantined')),
  captured_trigger_generation INTEGER,
  captured_authority_revision INTEGER NOT NULL,
  consequence_chain_id TEXT UNIQUE,
  lease_owner TEXT, lease_token TEXT UNIQUE, lease_expires_at_ms INTEGER,
  cancellation_id TEXT,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  CHECK ((state = 'terminal') = (terminal_reason IS NOT NULL))
);
CREATE INDEX idx_wakes_claim ON wakes(state, lease_expires_at_ms, created_at_ms, wake_id);
CREATE INDEX idx_wakes_conversation ON wakes(conversation_id, state, created_at_ms);
CREATE TABLE wake_legacy_quarantine (
  quarantine_id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  quarantined_at_ms INTEGER NOT NULL,
  UNIQUE(table_name, row_key)
);
ALTER TABLE future_triggers ADD COLUMN wake_id TEXT REFERENCES wakes(wake_id);
ALTER TABLE inbox_events ADD COLUMN wake_id TEXT REFERENCES wakes(wake_id);
ALTER TABLE cycle_records ADD COLUMN wake_id TEXT REFERENCES wakes(wake_id);
ALTER TABLE settlements ADD COLUMN wake_id TEXT REFERENCES wakes(wake_id);
ALTER TABLE settlements ADD COLUMN semantic_pass INTEGER;
ALTER TABLE in_flight_effects ADD COLUMN wake_id TEXT REFERENCES wakes(wake_id);
CREATE UNIQUE INDEX idx_future_triggers_wake ON future_triggers(wake_id) WHERE wake_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cycle_records_wake ON cycle_records(wake_id) WHERE wake_id IS NOT NULL;
CREATE UNIQUE INDEX idx_settlements_wake_pass ON settlements(wake_id, semantic_pass) WHERE wake_id IS NOT NULL AND semantic_pass IS NOT NULL;
CREATE UNIQUE INDEX idx_in_flight_effects_wake ON in_flight_effects(wake_id) WHERE wake_id IS NOT NULL;
CREATE INDEX idx_wake_legacy_quarantine_table ON wake_legacy_quarantine(table_name, quarantined_at_ms, quarantine_id);
UPDATE cognitive_sidecar_meta SET schema_version = 3, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V4 = String.raw`
ALTER TABLE inbox_events ADD COLUMN lane TEXT NOT NULL DEFAULT 'interactive';
ALTER TABLE inbox_events ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_events ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE inbox_events ADD COLUMN first_attempt_at_ms INTEGER;
ALTER TABLE inbox_events ADD COLUMN next_eligible_at_ms INTEGER;
ALTER TABLE inbox_events ADD COLUMN last_failure_class TEXT;
ALTER TABLE inbox_events ADD COLUMN terminal_reason TEXT;
ALTER TABLE inbox_events ADD COLUMN quarantine_reason TEXT;
ALTER TABLE inbox_events ADD COLUMN repair_of_event_id TEXT;
ALTER TABLE inbox_events ADD COLUMN payload_hash TEXT;
CREATE TABLE durable_work_attempts (
  attempt_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES inbox_events(id),
  wake_id TEXT REFERENCES wakes(wake_id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  worker_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  dispatch_truth TEXT NOT NULL CHECK (dispatch_truth IN ('not_started','attempted','provider_responded','unknown')),
  failure_class TEXT,
  error_code TEXT,
  UNIQUE(event_id, ordinal)
);
CREATE TABLE retry_lane_fairness (
  lane TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_served_at_ms INTEGER NOT NULL,
  PRIMARY KEY(lane, conversation_id)
);
CREATE TABLE durable_work_repairs (
  repair_event_id TEXT PRIMARY KEY REFERENCES inbox_events(id),
  predecessor_event_id TEXT NOT NULL REFERENCES inbox_events(id),
  authorization_ref TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_work_eligible ON inbox_events(lane, state, next_eligible_at_ms, created_at_ms, id);
CREATE UNIQUE INDEX idx_one_active_conversation_lane ON inbox_events(conversation_id, lane) WHERE state='leased';
CREATE UNIQUE INDEX idx_durable_work_repairs_predecessor_authorization
  ON durable_work_repairs(predecessor_event_id, authorization_ref);

-- W6 migration is conservative. Existing attempt history is not reset and
-- rows whose external-dispatch truth cannot be reconstructed do not become
-- directly replayable work.
UPDATE inbox_events
   SET first_attempt_at_ms = COALESCE(first_attempt_at_ms, claimed_at_ms, created_at_ms)
 WHERE attempt_count > 0 OR claimed_at_ms IS NOT NULL;
UPDATE inbox_events
   SET state = CASE status
         WHEN 'consumed' THEN 'terminal'
         WHEN 'failed_terminal' THEN 'quarantined'
         WHEN 'claimed' THEN 'reconciling'
         WHEN 'failed_retryable' THEN 'reconciling'
         ELSE 'pending'
       END,
       status = CASE status
         WHEN 'claimed' THEN 'claimed'
         WHEN 'failed_retryable' THEN 'claimed'
         ELSE status
       END,
       terminal_reason = CASE status
         WHEN 'consumed' THEN 'completed'
         WHEN 'failed_terminal' THEN 'permanent_failure'
         ELSE terminal_reason
       END,
       quarantine_reason = CASE status
         WHEN 'failed_terminal' THEN 'legacy_terminal'
         WHEN 'claimed' THEN 'legacy_attempt_history_unverifiable'
         WHEN 'failed_retryable' THEN 'legacy_attempt_history_unverifiable'
         ELSE quarantine_reason
       END,
       last_failure_class = CASE status
         WHEN 'claimed' THEN 'outcome_unknown_reconcile'
         WHEN 'failed_retryable' THEN 'outcome_unknown_reconcile'
         ELSE last_failure_class
       END,
       claim_token = CASE WHEN status IN ('claimed', 'failed_retryable', 'consumed', 'failed_terminal') THEN NULL ELSE claim_token END,
       worker_id = CASE WHEN status IN ('claimed', 'failed_retryable', 'consumed', 'failed_terminal') THEN NULL ELSE worker_id END,
       lease_expires_at_ms = CASE WHEN status IN ('claimed', 'failed_retryable', 'consumed', 'failed_terminal') THEN NULL ELSE lease_expires_at_ms END;
UPDATE inbox_events
   SET state = 'quarantined',
       status = 'failed_terminal',
       terminal_reason = 'permanent_failure',
       quarantine_reason = 'legacy_wake_missing',
       last_error = COALESCE(last_error, 'legacy_wake_missing'),
       claim_token = NULL,
       worker_id = NULL,
       lease_expires_at_ms = NULL
 WHERE wake_id IS NULL AND state NOT IN ('terminal', 'quarantined');
UPDATE cognitive_sidecar_meta SET schema_version = 4, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V5 = String.raw`
CREATE TABLE private_budget_policy_clock (
  policy_id TEXT PRIMARY KEY,
  last_policy_now_ms INTEGER NOT NULL CHECK(last_policy_now_ms >= 0),
  clock_state TEXT NOT NULL CHECK(clock_state IN ('stable','clock_reconciliation')),
  discrepancy_ms INTEGER NOT NULL DEFAULT 0,
  reconciled_at_ms INTEGER,
  reconciliation_ref TEXT
);
CREATE TABLE private_budget_reservations (
  reservation_id TEXT PRIMARY KEY,
  admission_id TEXT NOT NULL UNIQUE,
  wake_id TEXT NOT NULL REFERENCES wakes(wake_id),
  conversation_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('held','committed','released','reconcile_required','expired')),
  policy_time_ms INTEGER NOT NULL,
  invocation_id TEXT,
  attempt_id TEXT,
  dispatch_truth TEXT NOT NULL CHECK(dispatch_truth IN ('not_bound','not_started','attempted','responded','unknown')),
  release_proof_ref TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(state != 'released' OR release_proof_ref IS NOT NULL),
  CHECK(state != 'committed' OR invocation_id IS NOT NULL)
);
CREATE INDEX idx_private_budget_consuming ON private_budget_reservations(conversation_id, policy_id, policy_time_ms, state);
CREATE UNIQUE INDEX idx_private_budget_invocation ON private_budget_reservations(invocation_id) WHERE invocation_id IS NOT NULL;
UPDATE cognitive_sidecar_meta SET schema_version = 5, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V6 = String.raw`
ALTER TABLE in_flight_effects ADD COLUMN origin_event_id TEXT REFERENCES inbox_events(id);
ALTER TABLE in_flight_effects ADD COLUMN origin_attempt_id TEXT REFERENCES durable_work_attempts(attempt_id);
ALTER TABLE durable_nominations ADD COLUMN source_refs_json TEXT;
CREATE INDEX idx_in_flight_origin_event ON in_flight_effects(origin_event_id);
CREATE INDEX idx_in_flight_origin_attempt ON in_flight_effects(origin_attempt_id);
UPDATE effect_receipts SET outcome = 'outcome_unknown' WHERE outcome IN ('failed', 'unknown');
UPDATE cognitive_sidecar_meta SET schema_version = 6, thought_contract_version = 2, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V7 = String.raw`
CREATE TABLE IF NOT EXISTS deferred_reactive_frontiers (
  frontier_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('waiting', 'running', 'resolved', 'exhausted')),
  next_eligible_at_ms INTEGER NOT NULL,
  capacity_deadline_at_ms INTEGER NOT NULL,
  latest_evidence_row_id TEXT NOT NULL,
  claim_token TEXT,
  lease_expires_at_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deferred_frontiers_active_conversation
ON deferred_reactive_frontiers (conversation_id)
WHERE state IN ('waiting', 'running');

CREATE INDEX IF NOT EXISTS idx_deferred_frontiers_poll
ON deferred_reactive_frontiers (state, next_eligible_at_ms)
WHERE state = 'waiting';

UPDATE cognitive_sidecar_meta SET schema_version = 7, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V8 = String.raw`
ALTER TABLE deferred_reactive_frontiers ADD COLUMN terminal_reason TEXT;

CREATE TABLE IF NOT EXISTS c3_terminal_experiences (
  experience_id TEXT PRIMARY KEY,
  obligation_frontier_id TEXT,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  attempt_id TEXT,
  attempt_lineage_json TEXT,
  terminal_phase TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  terminal_disposition TEXT NOT NULL,
  publication_state TEXT NOT NULL,
  external_effect_truth TEXT NOT NULL,
  receipt_ref TEXT,
  unresolved_state INTEGER NOT NULL DEFAULT 0,
  raw_evidence_refs_json TEXT NOT NULL,
  notice_id TEXT,
  occurred_at_ms INTEGER NOT NULL,
  source_domain_owner TEXT NOT NULL,
  source_currentness_ref TEXT,
  redacted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_c3_exp_cycle
  ON c3_terminal_experiences (cycle_id, generation);
CREATE INDEX IF NOT EXISTS idx_c3_exp_unresolved
  ON c3_terminal_experiences (unresolved_state, occurred_at_ms DESC);

CREATE TABLE IF NOT EXISTS c3_activation_cutover (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  activated_at_ms INTEGER NOT NULL,
  max_pre_v8_notice_id INTEGER,
  max_pre_v8_frontier_updated_at_ms INTEGER,
  max_pre_v8_attempt_finished_at_ms INTEGER,
  max_pre_v8_delivery_reservation_id INTEGER
);

INSERT OR IGNORE INTO c3_activation_cutover (
 id, activated_at_ms,
 max_pre_v8_notice_id,
 max_pre_v8_frontier_updated_at_ms,
 max_pre_v8_attempt_finished_at_ms,
 max_pre_v8_delivery_reservation_id
) VALUES (
  1,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  (SELECT MAX(notice_id) FROM system_notice_outbox),
  (SELECT MAX(updated_at_ms) FROM deferred_reactive_frontiers),
  (SELECT MAX(finished_at_ms) FROM durable_work_attempts),
  NULL
);

UPDATE cognitive_sidecar_meta
SET schema_version = 8,
    projection_state = 'reconciling'
WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V9 = String.raw`
-- F0 (periodic-autonomous-cognition R7 §15.1/S3): the 4/hour ceiling is global
-- per policy (ONE_ASHLEY). Replace the per-conversation consuming index with
-- the policy-scoped shape. No column changes; existing rows remain
-- interpretable (their timestamps and states already mean what the global
-- count needs). Idempotent: safe to apply regardless of which foundation
-- packet lands first.
DROP INDEX IF EXISTS idx_private_budget_consuming;
CREATE INDEX IF NOT EXISTS idx_private_budget_consuming
  ON private_budget_reservations (policy_id, policy_time_ms, state);
UPDATE cognitive_sidecar_meta SET schema_version = 9, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V10 = String.raw`
-- F1 (periodic-autonomous-cognition R7 §15.5/S2): append-only per-attempt
-- authorization for structural repair. The parent reservation row keeps the
-- single attempt-1 binding (immutable); attempts 2..N live ONLY here.
-- release_proof_ref records a child-level no-dispatch release proof (recovery
-- treats a bound-but-never-dispatched child exactly like a held parent).
-- Idempotent: safe to apply regardless of which foundation packet lands first.
CREATE TABLE IF NOT EXISTS private_budget_attempt_bindings (
  binding_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES private_budget_reservations(reservation_id),
  invocation_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 2 AND ordinal <= 12),
  reason TEXT NOT NULL CHECK(reason IN ('structural_repair', 'cycle_continuation')),
  dispatch_truth TEXT NOT NULL CHECK(dispatch_truth IN ('not_started','attempted','responded','unknown')),
  provider_request_id TEXT,
  release_proof_ref TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(reservation_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_attempt_bindings_reservation
  ON private_budget_attempt_bindings (reservation_id, ordinal);
UPDATE cognitive_sidecar_meta SET schema_version = 10, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V11 = String.raw`
-- P1 (periodic-autonomous-cognition R7 §§5-14/S1+S1b): singleton periodic
-- schedule + append-only occurrence receipts. The migration creates tables,
-- NOT the schedule row (lazy first-activation seed on first enabled poll).
-- Additive only: no backfill, no non-nullable columns on existing tables,
-- no secondary index. Downgrade invariant: old code ignores both tables and
-- all existing rows remain valid under it.
CREATE TABLE IF NOT EXISTS periodic_cognition_schedule (
  id TEXT PRIMARY KEY CHECK(id = 'ashley-periodic-v1'),
  authority_epoch INTEGER NOT NULL,
  next_eligible_at_ms INTEGER NOT NULL,
  pending_occurrence_id TEXT NULL,
  pending_wake_id TEXT NULL,
  pending_due_at_ms INTEGER NULL,
  pending_expires_at_ms INTEGER NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS periodic_cognition_occurrence_receipts (
  schedule_occurrence_id TEXT PRIMARY KEY,
  disposition TEXT NOT NULL CHECK(disposition IN ('admitted','admitted_failure','skipped_empty','expired','admitted_stale_suppressed','authority_epoch_abandoned')),
  wake_id TEXT NULL,
  authority_epoch INTEGER NOT NULL,
  eligible_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER NOT NULL,
  detail TEXT NULL
);
UPDATE cognitive_sidecar_meta SET schema_version = 11, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V12 = String.raw`
-- A (wake terminal vocabulary): rebuild only the wakes table so the
-- terminal CHECK admits superseded. Child tables keep their existing
-- references and all existing row values are copied without backfill.
CREATE TABLE wakes_v12 (
  wake_id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL UNIQUE,
  trigger_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('inbox','future_trigger','idle','subscription')),
  conversation_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','authorized','consequence_pending','reconciling','terminal')),
  terminal_reason TEXT CHECK (terminal_reason IS NULL OR terminal_reason IN ('completed','no_action','refused','cancelled','expired','quarantined','superseded')),
  captured_trigger_generation INTEGER,
  captured_authority_revision INTEGER NOT NULL,
  consequence_chain_id TEXT UNIQUE,
  lease_owner TEXT, lease_token TEXT UNIQUE, lease_expires_at_ms INTEGER,
  cancellation_id TEXT,
  created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  CHECK ((state = 'terminal') = (terminal_reason IS NOT NULL))
);
INSERT INTO wakes_v12 (
  wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
  state, terminal_reason, captured_trigger_generation, captured_authority_revision,
  consequence_chain_id, lease_owner, lease_token, lease_expires_at_ms,
  cancellation_id, created_at_ms, updated_at_ms
)
SELECT
  wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
  state, terminal_reason, captured_trigger_generation, captured_authority_revision,
  consequence_chain_id, lease_owner, lease_token, lease_expires_at_ms,
  cancellation_id, created_at_ms, updated_at_ms
FROM wakes;
`;

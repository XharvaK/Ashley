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

export const COGNITIVE_SIDECAR_SCHEMA_V13 = String.raw`
-- Bounded autonomous public Discord presence. The singleton stores the
-- admitted desired state; Discord projection remains owned by the bot.
CREATE TABLE IF NOT EXISTS public_presence_state (
  id TEXT PRIMARY KEY CHECK (id = 'ashley-public-presence-v1'),
  action TEXT NOT NULL CHECK (action IN ('set', 'clear')),
  text TEXT,
  authored_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,
  source_cycle_id TEXT NOT NULL,
  source_generation INTEGER NOT NULL,
  source_effect_id TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  projection_state TEXT NOT NULL CHECK (projection_state IN ('pending', 'projected', 'failed', 'unknown')),
  projection_attempt_at_ms INTEGER,
  projection_outcome TEXT CHECK (projection_outcome IS NULL OR projection_outcome IN ('succeeded', 'failed', 'unknown')),
  projection_cause TEXT,
  projection_error TEXT,
  updated_at_ms INTEGER NOT NULL,
  CHECK (
    (action = 'set' AND text IS NOT NULL AND expires_at_ms IS NOT NULL)
    OR (action = 'clear' AND text IS NULL AND expires_at_ms IS NULL)
  )
);
UPDATE cognitive_sidecar_meta SET schema_version = 13, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V14 = String.raw`
ALTER TABLE conversation_evidence_log ADD COLUMN speaker_principal_id TEXT;
ALTER TABLE conversation_evidence_log ADD COLUMN speaker_kind TEXT CHECK(speaker_kind IS NULL OR speaker_kind IN ('owner','external_human','external_bot','ashley'));
ALTER TABLE conversation_evidence_log ADD COLUMN location_json TEXT CHECK(location_json IS NULL OR json_valid(location_json));
ALTER TABLE conversation_evidence_log ADD COLUMN audience_at_capture TEXT CHECK(audience_at_capture IS NULL OR audience_at_capture IN ('owner_private','dm','room'));
ALTER TABLE conversation_evidence_log ADD COLUMN sent_at_ms INTEGER;
ALTER TABLE conversation_evidence_log ADD COLUMN reply_to_message_id TEXT;
ALTER TABLE conversation_evidence_log ADD COLUMN mention_ids_json TEXT CHECK(mention_ids_json IS NULL OR json_valid(mention_ids_json));
ALTER TABLE conversation_evidence_log ADD COLUMN attachment_refs_json TEXT CHECK(attachment_refs_json IS NULL OR json_valid(attachment_refs_json));
ALTER TABLE conversation_evidence_log ADD COLUMN provenance_json TEXT CHECK(provenance_json IS NULL OR json_valid(provenance_json));

ALTER TABLE inbox_events ADD COLUMN envelope_json TEXT CHECK(envelope_json IS NULL OR json_valid(envelope_json));

ALTER TABLE cycle_records ADD COLUMN attempt_id TEXT;
ALTER TABLE cycle_records ADD COLUMN attempt_input_basis_json TEXT CHECK(attempt_input_basis_json IS NULL OR json_valid(attempt_input_basis_json));
ALTER TABLE cycle_records ADD COLUMN supersessions_used INTEGER NOT NULL DEFAULT 0 CHECK(supersessions_used BETWEEN 0 AND 2);
ALTER TABLE cycle_records ADD COLUMN pending_queue_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pending_queue_json));
ALTER TABLE cycle_records ADD COLUMN disposition TEXT CHECK(disposition IS NULL OR disposition IN ('intentional_silence','technical_failure','resource_deferred','owner_preempted','hard_invalidated','unresolved_deferred','candidate_ready','publication_admitted','dispatching','delivered','partially_delivered','uncertain','blocked_at_dispatch'));

CREATE TABLE IF NOT EXISTS social_conversations (
  conversation_id TEXT PRIMARY KEY,
  kind TEXT CHECK(kind IN ('dm','room','thread')) NOT NULL,
  principal_id TEXT,
  guild_id TEXT,
  channel_id TEXT,
  thread_id TEXT,
  audience TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_at_ms INTEGER NOT NULL,
  CHECK((kind='dm' AND principal_id IS NOT NULL) OR (kind='room' AND channel_id IS NOT NULL) OR kind='thread')
);
CREATE INDEX IF NOT EXISTS idx_social_conv_lookup
  ON social_conversations(principal_id, channel_id, last_at_ms);

UPDATE cognitive_sidecar_meta SET schema_version = 14, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V15 = String.raw`
CREATE TABLE IF NOT EXISTS desk_entries (
  id TEXT PRIMARY KEY,
  concern_ref TEXT,
  body TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK(author_kind IN ('ashley', 'owner', 'quoted_external')),
  source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
  verbatim INTEGER NOT NULL CHECK(verbatim IN (0, 1)),
  form TEXT NOT NULL CHECK(form IN ('note', 'draft', 'observation', 'brainstorm')),
  endorsement_ref TEXT,
  audience_scope_json TEXT NOT NULL CHECK(json_valid(audience_scope_json)),
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active', 'archived', 'tombstoned')),
  superseded_by TEXT,
  updated_cycle TEXT NOT NULL,
  updated_generation INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_desk_entries_projection
  ON desk_entries(lifecycle, updated_generation DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_desk_entries_concern
  ON desk_entries(concern_ref, lifecycle);

UPDATE cognitive_sidecar_meta SET schema_version = 15, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V16 = String.raw`
ALTER TABLE observation_subscriptions ADD COLUMN external_source_type TEXT
  CHECK(external_source_type IS NULL OR external_source_type IN ('url', 'url_pattern', 'rss', 'atom', 'json'));
ALTER TABLE observation_subscriptions ADD COLUMN external_source_url_pattern TEXT;
ALTER TABLE observation_subscriptions ADD COLUMN poll_interval_ms INTEGER;
ALTER TABLE observation_subscriptions ADD COLUMN expires_at_ms INTEGER;
ALTER TABLE observation_subscriptions ADD COLUMN requester_id TEXT;
ALTER TABLE observation_subscriptions ADD COLUMN last_polled_at_ms INTEGER;
ALTER TABLE observation_subscriptions ADD COLUMN last_poll_outcome TEXT
  CHECK(last_poll_outcome IS NULL OR last_poll_outcome IN ('not_due', 'complete_no_match', 'matched', 'fetch_failure', 'timeout', 'partial', 'unavailable', 'rejected', 'expired'));
ALTER TABLE observation_subscriptions ADD COLUMN expiry_opportunity_emitted_at_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_observation_subscriptions_external_poll
  ON observation_subscriptions(cancelled, expires_at_ms, last_polled_at_ms, subscription_id);
UPDATE cognitive_sidecar_meta SET schema_version = 16, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V17 = String.raw`
UPDATE conversation_evidence_log SET speaker_kind = 'owner' WHERE role = 'owner' AND speaker_kind IS NULL;
UPDATE conversation_evidence_log SET speaker_kind = 'ashley' WHERE role = 'ashley' AND speaker_kind IS NULL;
UPDATE cognitive_sidecar_meta SET schema_version = 17, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V18 = String.raw`
ALTER TABLE observation_subscriptions ADD COLUMN poll_claim_token TEXT;
ALTER TABLE observation_subscriptions ADD COLUMN poll_claim_expires_at_ms INTEGER;
ALTER TABLE observation_subscriptions ADD COLUMN poll_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE observation_subscriptions ADD COLUMN ingested_frontier_at_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_observation_subscriptions_poll_claim
  ON observation_subscriptions(cancelled, poll_claim_expires_at_ms, subscription_id);
UPDATE cognitive_sidecar_meta SET schema_version = 18, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V19 = String.raw`
CREATE TABLE IF NOT EXISTS detached_operations (
  operation_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  origin_cycle_id TEXT NOT NULL,
  origin_generation INTEGER NOT NULL,
  origin_owner_event_id TEXT NOT NULL,
  origin_evidence_row_id TEXT,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('project.investigate')),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  purpose TEXT NOT NULL,
  evidence_need TEXT NOT NULL,
  admission_at_ms INTEGER NOT NULL,
  operation_deadline_at_ms INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  worker_binding_json TEXT CHECK(worker_binding_json IS NULL OR json_valid(worker_binding_json)),
  start_at_ms INTEGER,
  start_proof_ref TEXT,
  terminal_state TEXT CHECK(terminal_state IS NULL OR terminal_state IN ('succeeded', 'failed', 'outcome_unknown', 'cancelled', 'stopped')),
  terminal_at_ms INTEGER,
  observation_ref TEXT,
  receipt_ref TEXT,
  error_code TEXT,
  interim_outbox_ref TEXT,
  completion_event_ref TEXT,
  cancel_requested_at_ms INTEGER,
  superseded_by TEXT,
  successor_operation_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('admitted', 'started', 'succeeded', 'failed', 'outcome_unknown', 'cancelled', 'stopped')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_detached_operations_active_conversation
  ON detached_operations(conversation_id) WHERE state IN ('admitted', 'started');
CREATE INDEX IF NOT EXISTS idx_detached_operations_idempotency
  ON detached_operations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_detached_operations_deadline
  ON detached_operations(state, operation_deadline_at_ms);
UPDATE cognitive_sidecar_meta SET schema_version = 19, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V20 = String.raw`
CREATE TABLE IF NOT EXISTS operation_interim_outbox (
  interim_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  projection_key TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  surface_draft TEXT NOT NULL,
  presentation_directives_json TEXT NOT NULL CHECK(json_valid(presentation_directives_json)),
  send_status TEXT NOT NULL CHECK(send_status IN ('pending', 'projecting', 'projected', 'sending', 'delivered', 'partially_delivered', 'send_failure', 'suppressed', 'suppressed_shadow')),
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN (0, 1)),
  delivery_intent_json TEXT NOT NULL CHECK(json_valid(delivery_intent_json)),
  nuclear_reservation_id INTEGER,
  discord_message_id TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('live', 'shadow')),
  authorized_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operation_interim_outbox_operation
  ON operation_interim_outbox(operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_interim_outbox_status
  ON operation_interim_outbox(send_status, interim_id);
UPDATE cognitive_sidecar_meta SET schema_version = 20, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V21 = String.raw`
CREATE TABLE IF NOT EXISTS cognition_claims (
  conversation_id TEXT PRIMARY KEY,
  holder_event_id TEXT NOT NULL,
  holder_wake_id TEXT,
  cycle_id TEXT,
  generation INTEGER,
  claim_token TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
UPDATE cognitive_sidecar_meta SET schema_version = 21, projection_state = 'reconciling' WHERE id = 1;
`;

/**
 * V22 is the final WQ-compatible schema for the uncommitted candidate. No
 * persistent candidate-V22 database was found during the implementation
 * audit, so this migration replaces the candidate design in place rather
 * than adding a reconciliation-only V23.
 *
 * Queue undertakings own retained intent and global scheduling. Detached
 * operations own one concrete execution. Historical detached identities and
 * terminal truth are copied verbatim, with legacy rows classified as
 * OWNER_REQUEST by their required owner-event identity.
 */
export const COGNITIVE_SIDECAR_SCHEMA_V22 = String.raw`
DROP INDEX IF EXISTS idx_detached_operations_active_conversation;
DROP INDEX IF EXISTS idx_detached_operations_idempotency;
DROP INDEX IF EXISTS idx_detached_operations_deadline;
DROP INDEX IF EXISTS idx_detached_operations_capacity_wait;
ALTER TABLE detached_operations RENAME TO detached_operations_v21;
CREATE TABLE detached_operations (
  operation_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  origin_cycle_id TEXT NOT NULL,
  origin_generation INTEGER NOT NULL,
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('OWNER_REQUEST', 'ASHLEY_COMMITMENT', 'ASHLEY_CURIOSITY')),
  origin_ref TEXT NOT NULL,
  origin_owner_event_id TEXT,
  origin_evidence_row_id TEXT,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('project.investigate')),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  purpose TEXT NOT NULL,
  evidence_need TEXT NOT NULL,
  admission_at_ms INTEGER NOT NULL,
  operation_deadline_at_ms INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  worker_binding_json TEXT CHECK(worker_binding_json IS NULL OR json_valid(worker_binding_json)),
  start_at_ms INTEGER,
  start_proof_ref TEXT,
  terminal_state TEXT CHECK(terminal_state IS NULL OR terminal_state IN ('succeeded', 'failed', 'outcome_unknown', 'cancelled', 'stopped')),
  terminal_at_ms INTEGER,
  observation_ref TEXT,
  receipt_ref TEXT,
  error_code TEXT,
  interim_outbox_ref TEXT,
  completion_event_ref TEXT,
  cancel_requested_at_ms INTEGER,
  superseded_by TEXT,
  successor_operation_id TEXT,
  worker_undertaking_id TEXT UNIQUE,
  capacity_wait_reason TEXT,
  capacity_wait_started_at_ms INTEGER,
  capacity_wait_next_probe_at_ms INTEGER,
  state TEXT NOT NULL CHECK(state IN ('admitted', 'waiting_capacity', 'started', 'succeeded', 'failed', 'outcome_unknown', 'cancelled', 'stopped')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
  ,CHECK (
    (origin_kind = 'OWNER_REQUEST'
      AND origin_owner_event_id IS NOT NULL
      AND length(origin_owner_event_id) > 0
      AND origin_owner_event_id = origin_ref)
    OR (origin_kind IN ('ASHLEY_COMMITMENT', 'ASHLEY_CURIOSITY')
      AND origin_owner_event_id IS NULL)
  )
);
INSERT INTO detached_operations (
  operation_id, conversation_id, origin_cycle_id, origin_generation,
  origin_kind, origin_ref, origin_owner_event_id, origin_evidence_row_id, operation_kind,
  request_json, purpose, evidence_need, admission_at_ms,
  operation_deadline_at_ms, idempotency_key, worker_binding_json,
  start_at_ms, start_proof_ref, terminal_state, terminal_at_ms,
  observation_ref, receipt_ref, error_code, interim_outbox_ref,
  completion_event_ref, cancel_requested_at_ms, superseded_by,
  successor_operation_id, worker_undertaking_id, state, created_at_ms, updated_at_ms
)
SELECT
  operation_id, conversation_id, origin_cycle_id, origin_generation,
  'OWNER_REQUEST', origin_owner_event_id, origin_owner_event_id, origin_evidence_row_id, operation_kind,
  request_json, purpose, evidence_need, admission_at_ms,
  operation_deadline_at_ms, idempotency_key, worker_binding_json,
  start_at_ms, start_proof_ref, terminal_state, terminal_at_ms,
  observation_ref, receipt_ref, error_code, interim_outbox_ref,
  completion_event_ref, cancel_requested_at_ms, superseded_by,
  successor_operation_id, NULL, state, created_at_ms, updated_at_ms
FROM detached_operations_v21;
DROP TABLE detached_operations_v21;
CREATE INDEX idx_detached_operations_idempotency
  ON detached_operations(idempotency_key);
CREATE INDEX idx_detached_operations_deadline
  ON detached_operations(state, operation_deadline_at_ms);
CREATE INDEX idx_detached_operations_capacity_wait
  ON detached_operations(state, capacity_wait_next_probe_at_ms, operation_id);

DROP INDEX IF EXISTS idx_operation_interim_outbox_operation;
DROP INDEX IF EXISTS idx_operation_interim_outbox_status;
ALTER TABLE operation_interim_outbox RENAME TO operation_interim_outbox_v20;
CREATE TABLE operation_interim_outbox (
  interim_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT UNIQUE,
  undertaking_id TEXT UNIQUE,
  projection_key TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  surface_draft TEXT NOT NULL,
  presentation_directives_json TEXT NOT NULL CHECK(json_valid(presentation_directives_json)),
  send_status TEXT NOT NULL CHECK(send_status IN ('pending', 'projecting', 'projected', 'sending', 'delivered', 'partially_delivered', 'send_failure', 'suppressed', 'suppressed_shadow')),
  suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN (0, 1)),
  delivery_intent_json TEXT NOT NULL CHECK(json_valid(delivery_intent_json)),
  nuclear_reservation_id INTEGER,
  discord_message_id TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('live', 'shadow')),
  authorized_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((operation_id IS NOT NULL AND undertaking_id IS NULL)
      OR (operation_id IS NULL AND undertaking_id IS NOT NULL))
);
INSERT INTO operation_interim_outbox (
  interim_id, operation_id, undertaking_id, projection_key, conversation_id,
  cycle_id, generation, surface_draft, presentation_directives_json,
  send_status, suppressed, delivery_intent_json, nuclear_reservation_id,
  discord_message_id, origin, authorized_at_ms, created_at_ms, updated_at_ms
)
SELECT
  interim_id, operation_id, NULL, projection_key, conversation_id,
  cycle_id, generation, surface_draft, presentation_directives_json,
  send_status, suppressed, delivery_intent_json, nuclear_reservation_id,
  discord_message_id, origin, authorized_at_ms, created_at_ms, updated_at_ms
FROM operation_interim_outbox_v20;
DROP TABLE operation_interim_outbox_v20;
CREATE INDEX idx_operation_interim_outbox_operation
  ON operation_interim_outbox(operation_id);
CREATE INDEX idx_operation_interim_outbox_undertaking
  ON operation_interim_outbox(undertaking_id);
CREATE INDEX idx_operation_interim_outbox_status
  ON operation_interim_outbox(send_status, interim_id);

CREATE TABLE worker_undertakings (
  undertaking_id TEXT PRIMARY KEY,
  semantic_kind TEXT NOT NULL CHECK(semantic_kind IN ('project.inspect')),
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('OWNER_REQUEST', 'ASHLEY_COMMITMENT', 'ASHLEY_CURIOSITY')),
  origin_ref TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  conversation_id TEXT,
  origin_cycle_id TEXT NOT NULL,
  origin_generation INTEGER NOT NULL,
  origin_owner_event_id TEXT,
  origin_evidence_row_id TEXT,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  purpose TEXT NOT NULL,
  evidence_need TEXT NOT NULL,
  admission_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('queued', 'dispatching', 'running', 'succeeded', 'failed', 'outcome_unknown', 'cancelled', 'superseded', 'expired')),
  blocked_reason TEXT CHECK(blocked_reason IS NULL OR blocked_reason IN ('worker_busy', 'capacity')),
  queued_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  curiosity_expires_at_ms INTEGER,
  selected_operation_id TEXT UNIQUE,
  selected_calendar_index INTEGER,
  acknowledgement_ref TEXT,
  cancel_requested_at_ms INTEGER,
  superseded_by TEXT,
  terminal_reason TEXT,
  terminal_at_ms INTEGER,
  dispatch_claim_token TEXT,
  dispatch_claim_expires_at_ms INTEGER,
  capacity_wait_started_at_ms INTEGER,
  capacity_next_probe_at_ms INTEGER,
  CHECK (
    (origin_kind = 'OWNER_REQUEST'
      AND origin_owner_event_id IS NOT NULL
      AND length(origin_owner_event_id) > 0
      AND origin_owner_event_id = origin_ref)
    OR (origin_kind IN ('ASHLEY_COMMITMENT', 'ASHLEY_CURIOSITY')
      AND origin_owner_event_id IS NULL)
  ),
  CHECK (origin_kind <> 'ASHLEY_CURIOSITY' OR curiosity_expires_at_ms IS NOT NULL)
);
CREATE INDEX idx_worker_undertakings_queue
  ON worker_undertakings(state, origin_kind, queued_at_ms, undertaking_id);
CREATE INDEX idx_worker_undertakings_conversation
  ON worker_undertakings(conversation_id, origin_kind, state, origin_cycle_id);
CREATE INDEX idx_worker_undertakings_operation
  ON worker_undertakings(selected_operation_id);
CREATE INDEX idx_worker_undertakings_expiry
  ON worker_undertakings(state, origin_kind, curiosity_expires_at_ms, undertaking_id);

-- V21 detached work was admitted before queue ownership existed. Preserve its
-- exact operation identity and terminal/start truth under typed queue ownership.
INSERT INTO worker_undertakings (
  undertaking_id, semantic_kind, origin_kind, origin_ref, owner_id,
  conversation_id, origin_cycle_id, origin_generation,
  origin_owner_event_id, origin_evidence_row_id, request_json,
  purpose, evidence_need, admission_key, state, blocked_reason,
  queued_at_ms, updated_at_ms, curiosity_expires_at_ms,
  selected_operation_id, selected_calendar_index, acknowledgement_ref,
  cancel_requested_at_ms, superseded_by, terminal_reason, terminal_at_ms,
  dispatch_claim_token, dispatch_claim_expires_at_ms,
  capacity_wait_started_at_ms, capacity_next_probe_at_ms
)
SELECT
  'worker-undertaking:v21:' || operation_id,
  'project.inspect',
  'OWNER_REQUEST',
  origin_ref,
  'legacy-v21-migration',
  conversation_id,
  origin_cycle_id,
  origin_generation,
  origin_owner_event_id,
  origin_evidence_row_id,
  request_json,
  purpose,
  evidence_need,
  'legacy-v21:' || operation_id,
  CASE state
    WHEN 'admitted' THEN 'queued'
    WHEN 'started' THEN 'running'
    WHEN 'stopped' THEN 'failed'
    ELSE state
  END,
  NULL,
  admission_at_ms,
  updated_at_ms,
  NULL,
  operation_id,
  NULL,
  NULL,
  cancel_requested_at_ms,
  superseded_by,
  CASE WHEN terminal_state IS NULL THEN NULL ELSE COALESCE(error_code, terminal_state) END,
  terminal_at_ms,
  NULL,
  NULL,
  NULL,
  NULL
FROM detached_operations;

UPDATE detached_operations
   SET worker_undertaking_id = 'worker-undertaking:v21:' || operation_id;

CREATE TABLE worker_undertaking_scheduler (
  scheduler_id INTEGER PRIMARY KEY CHECK(scheduler_id = 1),
  cursor INTEGER NOT NULL CHECK(cursor >= 0 AND cursor < 7),
  updated_at_ms INTEGER NOT NULL
);
INSERT OR IGNORE INTO worker_undertaking_scheduler (scheduler_id, cursor, updated_at_ms)
VALUES (1, 0, 0);

CREATE TABLE worker_execution_slot (
  slot_id INTEGER PRIMARY KEY CHECK(slot_id = 1),
  undertaking_id TEXT,
  operation_id TEXT,
  claim_token TEXT,
  claim_expires_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
);
INSERT OR IGNORE INTO worker_execution_slot
  (slot_id, undertaking_id, operation_id, claim_token, claim_expires_at_ms, updated_at_ms)
VALUES (1, NULL, NULL, NULL, NULL, 0);

UPDATE worker_execution_slot
   SET undertaking_id = (
         SELECT undertaking_id FROM worker_undertakings
          WHERE state = 'running'
          ORDER BY queued_at_ms ASC, undertaking_id ASC LIMIT 1),
       operation_id = (
         SELECT selected_operation_id FROM worker_undertakings
          WHERE state = 'running'
          ORDER BY queued_at_ms ASC, undertaking_id ASC LIMIT 1),
       claim_token = CASE WHEN EXISTS (
         SELECT 1 FROM worker_undertakings WHERE state = 'running'
       ) THEN 'v21-migration' ELSE NULL END,
       claim_expires_at_ms = NULL,
       updated_at_ms = CASE WHEN EXISTS (
         SELECT 1 FROM worker_undertakings WHERE state = 'running'
       ) THEN COALESCE((SELECT updated_at_ms FROM worker_undertakings
          WHERE state = 'running'
          ORDER BY queued_at_ms ASC, undertaking_id ASC LIMIT 1), 0) ELSE 0 END
 WHERE slot_id = 1;

UPDATE cognitive_sidecar_meta SET schema_version = 22, projection_state = 'reconciling' WHERE id = 1;
`;

/**
 * V23 adds one nullable operational diagnostic to detached operations:
 * bounded sanitized worker-failure evidence (failure class, provider
 * status, error type, truncated message, process exit, model, OpenCode
 * version). No headers, keys, bodies, or environment are representable:
 * writers must pass pre-sanitized JSON through the allowlisted sanitizer.
 * Additive and idempotent: existing rows read back NULL.
 */
export const COGNITIVE_SIDECAR_SCHEMA_V23 = String.raw`
ALTER TABLE detached_operations ADD COLUMN failure_evidence_json TEXT CHECK(failure_evidence_json IS NULL OR json_valid(failure_evidence_json));
UPDATE cognitive_sidecar_meta SET schema_version = 23, projection_state = 'reconciling' WHERE id = 1;
`;

/**
 * V24 separates three independent concern axes.
 *
 * - `cognitive_status` is cognition-owned and NULLABLE. NULL means no
 *   cognition-authored cognitive status has been established; it is never a
 *   sixth status and never means dormant, resolved, active, quarantine, or
 *   forgotten. The physical column is renamed from `status` so no legacy
 *   NOT NULL cognitive column survives.
 * - `quarantine_kind` is a Host/E provenance-validity fact. Cognition may not
 *   author or clear it. Quarantine blocks foreground/trust; it never blocks
 *   cognitive-status authorship and is never an occupancy veto by itself.
 * - `forgotten` is an Owner privacy fact. Forgotten rows are redacted, hold no
 *   occupancy, and contribute zero to cognition-facing existence accounting.
 *
 * The table rebuild is `concerns.status` -> `concerns.cognitive_status`
 * closure: the old NOT NULL column does not survive.
 */
export const COGNITIVE_SIDECAR_SCHEMA_V24 = String.raw`
CREATE TABLE concerns_v24 (
  concern_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  assertion_key TEXT,
  cognitive_status TEXT,
  quarantine_kind TEXT,
  forgotten INTEGER NOT NULL DEFAULT 0,
  snapshot_hash TEXT NOT NULL,
  updated_cycle TEXT
);
INSERT INTO concerns_v24 (
  concern_id, conversation_id, statement, source_refs_json, dimensions_json,
  assertion_key, cognitive_status, quarantine_kind, forgotten, snapshot_hash, updated_cycle
)
SELECT
  concern_id, conversation_id, statement, source_refs_json, dimensions_json,
  assertion_key,
  CASE
    WHEN status IN ('active', 'investigating', 'waiting_for_evidence',
                    'dormant_but_revisitable', 'resolved')
      THEN status
    ELSE NULL
  END,
  NULL,
  0,
  snapshot_hash, updated_cycle
FROM concerns;
UPDATE cognitive_sidecar_meta SET schema_version = 24, projection_state = 'reconciling' WHERE id = 1;
`;

export const COGNITIVE_SIDECAR_SCHEMA_V25 = String.raw`
DROP INDEX IF EXISTS idx_in_flight_effects_wake;
CREATE UNIQUE INDEX idx_in_flight_effects_wake
  ON in_flight_effects(wake_id)
  WHERE wake_id IS NOT NULL AND state IN ('in_flight', 'unknown');
UPDATE cognitive_sidecar_meta SET schema_version = 25, projection_state = 'reconciling' WHERE id = 1;
`;

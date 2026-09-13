/**
 * Schema v18: multi-provider quota buckets.
 *
 * - attention_requests: rebuild with NOT NULL provider_id + quota_bucket and
 *   nullable route_alias; backfill legacy rows to the mistral bucket
 *   (`'mistral:' || model_alias`). A plain ALTER TABLE cannot add a NOT NULL
 *   column without a DEFAULT, so we use the rename+rebuild recipe from v15.
 * - attention_daily_usage: rebuild with PRIMARY KEY (day_utc, quota_bucket);
 *   model_alias/resolved_model_id/model_epoch stay as informational columns.
 * - decision_log: additive expression_fallback_policy column.
 * - New index on (quota_bucket, dispatch_started_at) for bucket-scoped
 *   RPS/TPM windows.
 */
export const MIGRATION_18_ATTENTION_BUCKETS = `
ALTER TABLE attention_requests RENAME TO attention_requests_v18;
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
  provider_id TEXT NOT NULL,
  route_alias TEXT,
  quota_bucket TEXT NOT NULL,
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
  (id, lane, purpose, model_alias, provider_id, route_alias, quota_bucket,
   resolved_model_id, model_epoch, state, outcome, error_class, queued_at,
   eligible_at, age_origin_at, deadline_at, reserved_at, dispatch_started_at,
   ended_at, dispatch_sequence, lease_expires_at, recovery_class, folded_at,
   estimated_input_tokens, estimated_output_tokens, reserved_input_tokens,
   reserved_output_tokens, actual_input_tokens, actual_output_tokens,
   budget_retain_until, delivery_reservation_id, decision_id, cognitive_job_id,
   owner_id, created_at)
SELECT id, lane, purpose, model_alias, 'mistral', NULL, 'mistral:' || model_alias,
       resolved_model_id, model_epoch, state, outcome, error_class, queued_at,
       eligible_at, age_origin_at, deadline_at, reserved_at, dispatch_started_at,
       ended_at, dispatch_sequence, lease_expires_at, recovery_class, folded_at,
       estimated_input_tokens, estimated_output_tokens, reserved_input_tokens,
       reserved_output_tokens, actual_input_tokens, actual_output_tokens,
       budget_retain_until, delivery_reservation_id, decision_id, cognitive_job_id,
       owner_id, created_at
FROM attention_requests_v18;
DROP TABLE attention_requests_v18;
CREATE INDEX IF NOT EXISTS idx_attention_requests_state_lane
  ON attention_requests (state, lane, eligible_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_dispatch_seq
  ON attention_requests (dispatch_sequence);
CREATE INDEX IF NOT EXISTS idx_attention_requests_folded
  ON attention_requests (folded_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_budget
  ON attention_requests (state, reserved_at, budget_retain_until);
CREATE INDEX IF NOT EXISTS idx_attention_requests_quota_bucket
  ON attention_requests (quota_bucket, dispatch_started_at);

ALTER TABLE attention_daily_usage RENAME TO attention_daily_usage_v18;
CREATE TABLE attention_daily_usage (
  day_utc TEXT NOT NULL,
  quota_bucket TEXT NOT NULL,
  model_alias TEXT NOT NULL DEFAULT '',
  resolved_model_id TEXT NOT NULL DEFAULT '',
  model_epoch INTEGER NOT NULL DEFAULT 0,
  requests_completed INTEGER NOT NULL DEFAULT 0,
  requests_cancelled INTEGER NOT NULL DEFAULT 0,
  requests_timeout INTEGER NOT NULL DEFAULT 0,
  requests_rate_limited INTEGER NOT NULL DEFAULT 0,
  requests_error INTEGER NOT NULL DEFAULT 0,
  requests_aborted INTEGER NOT NULL DEFAULT 0,
  lane_interactive INTEGER NOT NULL DEFAULT 0,
  lane_urgent_grounded INTEGER NOT NULL DEFAULT 0,
  lane_exchange_cognition INTEGER NOT NULL DEFAULT 0,
  lane_curiosity_maintenance INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER NOT NULL DEFAULT 0,
  actual_output_tokens INTEGER NOT NULL DEFAULT 0,
  unknown_reserved_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day_utc, quota_bucket)
);
INSERT INTO attention_daily_usage
  (day_utc, quota_bucket, model_alias, resolved_model_id, model_epoch,
   requests_completed, requests_cancelled, requests_timeout,
   requests_rate_limited, requests_error, requests_aborted,
   lane_interactive, lane_urgent_grounded, lane_exchange_cognition,
   lane_curiosity_maintenance, actual_input_tokens, actual_output_tokens,
   unknown_reserved_tokens, updated_at)
SELECT day_utc, 'mistral:' || model_alias, model_alias, resolved_model_id, model_epoch,
       requests_completed, requests_cancelled, requests_timeout,
       requests_rate_limited, requests_error, requests_aborted,
       lane_interactive, lane_urgent_grounded, lane_exchange_cognition,
       lane_curiosity_maintenance, actual_input_tokens, actual_output_tokens,
       unknown_reserved_tokens, updated_at
FROM attention_daily_usage_v18;
DROP TABLE attention_daily_usage_v18;

ALTER TABLE decision_log ADD COLUMN expression_fallback_policy TEXT;
`;

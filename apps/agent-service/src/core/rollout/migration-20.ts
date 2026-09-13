/**
 * Nuclear schema v20 — capability rollout Wave 1.
 *
 * Rebuilds `capability_events` with an extended `kind` CHECK constraint that
 * admits `operator_promote` so explicit owner/operator promotion decisions
 * can be recorded in the same audit/event infrastructure as the evidence
 * kinds (`isolated_eval`, `live_shadow`, `behavioral_breach`,
 * `critical_failure`). Existing rows, the unique evidence key, and the
 * release foreign key are preserved.
 */

export const MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL = `
ALTER TABLE capability_events RENAME TO capability_events_v20;
CREATE TABLE capability_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  capability     TEXT NOT NULL,
  release_id     TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'isolated_eval', 'live_shadow', 'behavioral_breach',
                   'critical_failure', 'operator_promote'
                 )),
  source_key     TEXT NOT NULL,
  detail_json    TEXT NOT NULL DEFAULT '{}',
  occurred_at    TEXT NOT NULL,
  contract_id    TEXT,
  build_identity TEXT,
  model_epoch    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(capability, release_id, kind, source_key),
  FOREIGN KEY (capability, release_id)
    REFERENCES capability_releases(capability, release_id)
);
INSERT INTO capability_events
  (id, capability, release_id, kind, source_key, detail_json, occurred_at,
   contract_id, build_identity, model_epoch)
SELECT id, capability, release_id, kind, source_key, detail_json, occurred_at,
       contract_id, build_identity, model_epoch
FROM capability_events_v20;
DROP TABLE capability_events_v20;
CREATE INDEX idx_capability_events_window
  ON capability_events (capability, release_id, kind, occurred_at DESC);
`;

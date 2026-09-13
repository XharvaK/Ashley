/**
 * Nuclear schema v22 — Recall Authority Boundary Hardening.
 *
 * 1. Rebuilds `episodes` to include `provenance` in the `UNIQUE` constraint,
 *    allowing a shadow and live episode to coexist for the same message range.
 * 2. Rebuilds `capability_events` to admit `operator_rollback` and
 *    `operator_cutover`.
 * 3. Creates `recall_live_cutovers` for explicit historical live watermarks.
 */

export const MIGRATION_22_RECALL_AUTHORITY_DDL = `
-- 1. Rebuild episodes
CREATE TABLE episodes_v22 (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                TEXT NOT NULL,
  thread_id               TEXT NOT NULL REFERENCES mem_threads(id),
  summary                 TEXT NOT NULL,
  entities                TEXT NOT NULL DEFAULT '',
  source_start_message_id INTEGER NOT NULL REFERENCES mem_messages(id),
  source_end_message_id   INTEGER NOT NULL REFERENCES mem_messages(id),
  salience                REAL NOT NULL DEFAULT 0.5,
  unresolved              INTEGER NOT NULL DEFAULT 0 CHECK (unresolved IN (0, 1)),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'forgotten')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  entity_uuid             TEXT,
  data_classification     TEXT,
  provenance              TEXT NOT NULL DEFAULT 'shadow' CHECK (provenance IN ('shadow', 'live')),
  UNIQUE(owner_id, thread_id, source_start_message_id, source_end_message_id, provenance)
);

INSERT INTO episodes_v22
  (id, owner_id, thread_id, summary, entities, source_start_message_id, source_end_message_id,
   salience, unresolved, status, created_at, updated_at, entity_uuid, data_classification, provenance)
SELECT
  id, owner_id, thread_id, summary, entities, source_start_message_id, source_end_message_id,
  salience, unresolved, status, created_at, updated_at, entity_uuid, data_classification, provenance
FROM episodes;

DROP TABLE episodes;
ALTER TABLE episodes_v22 RENAME TO episodes;

CREATE INDEX idx_episodes_owner
  ON episodes (owner_id, status, unresolved DESC, salience DESC, updated_at DESC);
CREATE INDEX idx_episodes_thread_end
  ON episodes (owner_id, thread_id, source_end_message_id DESC);
CREATE INDEX idx_episodes_provenance
  ON episodes (owner_id, provenance, status, id DESC);
CREATE UNIQUE INDEX idx_episodes_entity_uuid
  ON episodes (entity_uuid) WHERE entity_uuid IS NOT NULL;

-- 2. Rebuild capability_events
ALTER TABLE capability_events RENAME TO capability_events_v21;
CREATE TABLE capability_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  capability     TEXT NOT NULL,
  release_id     TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN (
                   'isolated_eval', 'live_shadow', 'behavioral_breach',
                   'critical_failure', 'operator_promote',
                   'operator_rollback', 'operator_cutover'
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
FROM capability_events_v21;
DROP TABLE capability_events_v21;

CREATE INDEX idx_capability_events_window
  ON capability_events (capability, release_id, kind, occurred_at DESC);

-- 3. Create recall_live_cutovers
CREATE TABLE recall_live_cutovers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id          TEXT NOT NULL,
  capability        TEXT NOT NULL DEFAULT 'recall' CHECK (capability = 'recall'),
  release_id        TEXT NOT NULL,
  cutoff_message_id INTEGER NOT NULL CHECK (cutoff_message_id >= 0),
  authorized_by     TEXT NOT NULL,
  contract_id       TEXT NOT NULL,
  build_identity    TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE(owner_id, capability, release_id),
  FOREIGN KEY (capability, release_id)
    REFERENCES capability_releases(capability, release_id)
);
`;

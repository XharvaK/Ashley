export const MIGRATION_14_RELATIONSHIP_DDL = `
CREATE TABLE IF NOT EXISTS doc_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'due', 'deferred', 'fulfilled', 'cancelled', 'missed', 'motivated'
  )),
  due_at TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_doc_reminders_owner_status
  ON doc_reminders (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_doc_reminders_due
  ON doc_reminders (owner_id, due_at);

CREATE TABLE IF NOT EXISTS ashley_self_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'active', 'fulfilled', 'released', 'forgotten', 'motivated'
  )),
  due_at TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_ashley_self_commitments_owner
  ON ashley_self_commitments (owner_id, status);

CREATE TABLE IF NOT EXISTS mutual_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'proposed', 'active', 'fulfilled', 'released'
  )),
  doc_confirmed_at TEXT,
  ashley_confirmed_at TEXT,
  doc_evidence_entity_uuid TEXT,
  ashley_delivery_entity_uuid TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_mutual_commitments_owner
  ON mutual_commitments (owner_id, status);

CREATE TABLE IF NOT EXISTS scheduled_proactive_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'scheduled', 'motivated', 'sent', 'cancelled', 'missed', 'deferred'
  )),
  scheduled_at TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  decision_id INTEGER,
  delivery_receipt_id TEXT,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_proactive_owner
  ON scheduled_proactive_messages (owner_id, scheduled_at);

CREATE TABLE IF NOT EXISTS relational_tensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  repair_status TEXT NOT NULL DEFAULT 'none' CHECK (repair_status IN (
    'none', 'open', 'repairing', 'resolved'
  )),
  linked_withdrawal_entity_uuid TEXT,
  last_repair_decision_id INTEGER,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);

CREATE TABLE IF NOT EXISTS withdrawal_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  data_classification TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'lifted')),
  repair_status TEXT NOT NULL DEFAULT 'none' CHECK (repair_status IN (
    'none', 'cooling', 'eligible', 'attempted', 'backoff'
  )),
  initiator TEXT NOT NULL CHECK (initiator IN ('doc', 'ashley', 'system')),
  scope TEXT NOT NULL CHECK (scope IN (
    'turn', 'topic', 'initiative', 'relationship_pause', 'boundary_repair'
  )),
  reason TEXT NOT NULL,
  expires_at TEXT,
  topic_hint TEXT,
  turn_consumed INTEGER NOT NULL DEFAULT 0,
  linked_tension_entity_uuid TEXT,
  repair_attempt_count INTEGER NOT NULL DEFAULT 0,
  repair_decision_id INTEGER,
  repair_delivery_receipt_id TEXT,
  repair_reply_window_until TEXT,
  cooling_until TEXT,
  reopen_source_entity_uuid TEXT,
  source_entity_type TEXT NOT NULL,
  source_entity_uuid TEXT NOT NULL,
  evidence_json TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, source_entity_uuid, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_owner_active
  ON withdrawal_records (owner_id, status, scope);

CREATE TABLE IF NOT EXISTS relationship_motivation_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  entity_uuid TEXT NOT NULL UNIQUE,
  relationship_entity_type TEXT NOT NULL,
  relationship_entity_uuid TEXT NOT NULL,
  motivation_id INTEGER,
  claim_state TEXT NOT NULL CHECK (claim_state IN (
    'claimed', 'released', 'committed', 'aborted'
  )),
  lease_until TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_claim_active
  ON relationship_motivation_claims (owner_id, relationship_entity_uuid)
  WHERE claim_state = 'claimed';
`;

export const MIGRATION_14_MOTIVATIONS_KIND = `
ALTER TABLE motivations RENAME TO motivations_v14;
CREATE TABLE motivations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'user_message', 'question', 'fact', 'callback', 'opinion',
                 'take', 'unfinished', 'identity', 'availability', 'boundary',
                 'silence_signal', 'silence_ok', 'reminder', 'scheduled_proactive'
               )),
  score        REAL NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT,
  entity_uuid  TEXT,
  data_classification TEXT
);
INSERT INTO motivations
  (id, owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at,
   entity_uuid, data_classification)
SELECT id, owner_id, kind, score, ref_type, ref_id, summary, created_at,
       consumed_at, entity_uuid, data_classification
FROM motivations_v14;
DROP TABLE motivations_v14;
CREATE INDEX IF NOT EXISTS idx_nuclear_motivations_owner
  ON motivations (owner_id, created_at DESC, score DESC);
`;

export const MIGRATION_14_DECISION_LOG_COLUMNS = `
ALTER TABLE decision_log ADD COLUMN hold_reason_code TEXT;
ALTER TABLE decision_log ADD COLUMN silence_reason_code TEXT;
`;

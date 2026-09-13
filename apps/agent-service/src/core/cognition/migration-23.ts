/**
 * Nuclear schema v23 — bounded persistent Open Cognitive Items.
 *
 * The source record remains authoritative. These tables store only a bounded
 * semantic inventory, operational attention metadata, and transition codes.
 */
export const MIGRATION_23_OPEN_COGNITIVE_ITEMS_DDL = `
CREATE TABLE IF NOT EXISTS open_cognitive_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id            TEXT NOT NULL,
  entity_uuid         TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL CHECK (kind IN ('question', 'revisit', 'concern')),
  status              TEXT NOT NULL CHECK (
                        status IN ('OPEN', 'RESOLVED', 'WITHDRAWN', 'SUPERSEDED')
                      ),
  semantic_summary    TEXT NOT NULL CHECK (length(semantic_summary) BETWEEN 1 AND 512),
  source_type         TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
  source_id           TEXT NOT NULL CHECK (length(trim(source_id)) > 0),
  source_entity_uuid  TEXT NOT NULL CHECK (length(trim(source_entity_uuid)) > 0),
  semantic_key_hash   TEXT NOT NULL CHECK (length(semantic_key_hash) = 64),
  source_capability   TEXT NOT NULL CHECK (length(trim(source_capability)) > 0),
  contract_id         TEXT NOT NULL CHECK (length(trim(contract_id)) > 0),
  provenance          TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  source_revision     TEXT NOT NULL DEFAULT '',
  origin              TEXT NOT NULL CHECK (
                        origin IN ('cognition', 'reflection', 'runtime', 'manual')
                      ),
  build_identity      TEXT NOT NULL CHECK (length(trim(build_identity)) > 0),
  model_epoch         INTEGER NOT NULL DEFAULT 0 CHECK (model_epoch >= 0),
  data_classification TEXT NOT NULL DEFAULT 'never_public' CHECK (
                        data_classification IN ('ordinary', 'sensitive', 'never_public', 'secret')
                      ),
  status_reason       TEXT NOT NULL CHECK (length(status_reason) BETWEEN 1 AND 128),
  redacted_at         TEXT,
  redaction_code      TEXT CHECK (redaction_code IS NULL OR length(redaction_code) BETWEEN 1 AND 64),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  resolved_at         TEXT,
  UNIQUE (owner_id, semantic_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_open_cognitive_items_owner_status
  ON open_cognitive_items (owner_id, status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_open_cognitive_items_source
  ON open_cognitive_items (owner_id, source_type, source_entity_uuid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_cognitive_items_provenance
  ON open_cognitive_items (owner_id, provenance, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS open_cognitive_item_attention (
  item_id               INTEGER PRIMARY KEY REFERENCES open_cognitive_items(id) ON DELETE CASCADE,
  delay_class           TEXT CHECK (
                          delay_class IS NULL OR
                          delay_class IN ('none', 'brief', 'standard', 'long', 'reflection_review')
                        ),
  defer_until           TEXT,
  last_considered_at    TEXT,
  consideration_count   INTEGER NOT NULL DEFAULT 0 CHECK (consideration_count >= 0),
  last_outcome_code     TEXT CHECK (
                          last_outcome_code IS NULL OR
                          length(last_outcome_code) BETWEEN 1 AND 64
                        ),
  review_requested_at   TEXT,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_cognitive_item_attention_due
  ON open_cognitive_item_attention (defer_until, item_id);

CREATE TABLE IF NOT EXISTS open_cognitive_item_transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES open_cognitive_items(id) ON DELETE CASCADE,
  owner_id    TEXT NOT NULL,
  from_status TEXT CHECK (
                from_status IS NULL OR
                from_status IN ('OPEN', 'RESOLVED', 'WITHDRAWN', 'SUPERSEDED')
              ),
  to_status   TEXT NOT NULL CHECK (
                to_status IN ('OPEN', 'RESOLVED', 'WITHDRAWN', 'SUPERSEDED')
              ),
  reason      TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 128),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_cognitive_item_transitions_item
  ON open_cognitive_item_transitions (item_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_open_cognitive_item_transitions_owner
  ON open_cognitive_item_transitions (owner_id, created_at DESC, id DESC);
`;

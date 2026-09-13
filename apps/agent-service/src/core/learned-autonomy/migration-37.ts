import type { DatabaseSync } from "node:sqlite";

export const C3_CONTRACT_VERSION = 1;

export const C3_TABLES = [
  "learned_influences",
  "learned_influence_evidence",
  "learned_choice_receipts",
  "identity_seed_lineage",
] as const;

export const C3_INDEXES = [
  "idx_learned_influences_owner_state",
  "idx_learned_influences_entity_uuid",
  "idx_learned_influence_evidence_learned",
  "idx_learned_influence_evidence_assertion",
  "idx_learned_choice_receipts_owner_created",
  "idx_learned_choice_receipts_learned_created",
  "idx_identity_seed_lineage_owner_entry",
] as const;

/** Expand the existing motivation vocabulary without changing old rows. */
export const MIGRATION_38_MOTIVATIONS_KIND = `
ALTER TABLE motivations RENAME TO motivations_v38;
CREATE TABLE motivations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'user_message', 'question', 'fact', 'callback', 'opinion',
                 'take', 'unfinished', 'identity', 'availability', 'boundary',
                 'silence_signal', 'silence_ok', 'reminder', 'scheduled_proactive',
                 'learned_interest'
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
SELECT id, owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at,
       entity_uuid, data_classification
FROM motivations_v38;
DROP TABLE motivations_v38;
CREATE INDEX IF NOT EXISTS idx_nuclear_motivations_owner
  ON motivations (owner_id, created_at DESC, score DESC);
`;

/**
 * C3 stores a derived, reviewable interest binding. It never stores shared
 * culture or a second identity. Evidence remains linked to C1 assertions so
 * currentness can be re-evaluated synchronously by the reader.
 */
export const MIGRATION_38_LEARNED_AUTONOMY_DDL = `
CREATE TABLE IF NOT EXISTS learned_influences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('interest')),
  subject_facet TEXT NOT NULL CHECK (subject_facet IN (
    'owner_model', 'external_verifiable', 'ashley_side', 'unknown'
  )),
  semantic_owner TEXT NOT NULL CHECK (semantic_owner IN (
    'memory_evidence', 'identity', 'mind_state', 'thought', 'agency'
  )),
  semantic_owner_ref TEXT NOT NULL,
  lineage_kind TEXT NOT NULL CHECK (lineage_kind IN (
    'unknown', 'explicit_seed', 'owner_designated', 'observed_overlap',
    'ashley_native'
  )),
  influence_class TEXT NOT NULL CHECK (influence_class IN ('I0', 'I1', 'I2', 'I3')),
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  proposal_lifecycle TEXT NOT NULL CHECK (proposal_lifecycle IN (
    'proposed', 'admitted_to_review', 'withdrawn', 'expired_as_proposal'
  )),
  adjudication_state TEXT NOT NULL CHECK (adjudication_state IN (
    'pending', 'accepted', 'declined'
  )),
  adjudicator TEXT CHECK (adjudicator IS NULL OR adjudicator IN (
    'thought', 'natural_owner'
  )),
  adjudication_decision_id TEXT,
  qualified_at TEXT,
  contradiction_state TEXT NOT NULL DEFAULT 'none' CHECK (contradiction_state IN (
    'none', 'contradicted', 'superseded', 'demoted', 'expired',
    'owner_corrected'
  )),
  contradiction_reason TEXT,
  demoted_at TEXT,
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (
    'observe', 'dark_apply', 'apply'
  )),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  classification_source TEXT NOT NULL CHECK (classification_source IN (
    'copied', 'derived_most_restrictive'
  )),
  classification_invalidated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (subject_facet <> 'shared_projection'),
  CHECK (adjudication_state <> 'accepted' OR qualified_at IS NOT NULL),
  CHECK (adjudication_state <> 'accepted' OR adjudicator IS NOT NULL),
  CHECK (adjudication_state <> 'accepted' OR adjudication_decision_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS learned_influence_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  learned_influence_id INTEGER NOT NULL REFERENCES learned_influences(id),
  owner_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('assertion')),
  evidence_id TEXT NOT NULL,
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  observed_at TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  source_content_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (learned_influence_id, evidence_type, evidence_id)
);

CREATE TABLE IF NOT EXISTS learned_choice_receipts (
  receipt_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  learned_id INTEGER NOT NULL REFERENCES learned_influences(id),
  choice_kind TEXT NOT NULL CHECK (choice_kind IN (
    'curiosity_rank', 'motivation_admission', 'thought_selection'
  )),
  candidate_ids_json TEXT NOT NULL CHECK (json_valid(candidate_ids_json)),
  selected_ids_json TEXT NOT NULL CHECK (json_valid(selected_ids_json)),
  rank_delta_json TEXT NOT NULL CHECK (json_valid(rank_delta_json)),
  policy_binding TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  input_content_hash TEXT NOT NULL,
  output_content_hash TEXT NOT NULL,
  eligible_input_affected_ranking INTEGER NOT NULL CHECK (
    eligible_input_affected_ranking IN (0, 1)
  ),
  agency_made_final_choice INTEGER NOT NULL CHECK (
    agency_made_final_choice IN (0, 1)
  ),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_seed_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  identity_entry_id INTEGER NOT NULL REFERENCES identity_entries(id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'retained', 'independently_reinterpreted', 'rejected'
  )),
  seed_source TEXT NOT NULL CHECK (seed_source IN (
    'explicit_seed', 'owner_designated', 'historical', 'historical_source'
  )),
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, identity_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_learned_influences_owner_state
  ON learned_influences (owner_id, adjudication_state, contradiction_state, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_influences_entity_uuid
  ON learned_influences (entity_uuid);
CREATE INDEX IF NOT EXISTS idx_learned_influence_evidence_learned
  ON learned_influence_evidence (learned_influence_id, observed_at, id);
CREATE INDEX IF NOT EXISTS idx_learned_influence_evidence_assertion
  ON learned_influence_evidence (assertion_id, learned_influence_id);
CREATE INDEX IF NOT EXISTS idx_learned_choice_receipts_owner_created
  ON learned_choice_receipts (owner_id, created_at DESC, receipt_id DESC);
CREATE INDEX IF NOT EXISTS idx_learned_choice_receipts_learned_created
  ON learned_choice_receipts (learned_id, created_at DESC, receipt_id DESC);
CREATE INDEX IF NOT EXISTS idx_identity_seed_lineage_owner_entry
  ON identity_seed_lineage (owner_id, identity_entry_id);
`;

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

function fail(detail: string): never {
  throw new Error(`nuclear_schema_content_invalid:v38:${detail}`);
}

function requireColumns(db: DatabaseSync, table: string, names: string[]): void {
  const present = columns(db, table);
  for (const name of names) {
    if (!present.has(name)) fail(`missing_column:${table}.${name}`);
  }
}

function requireSqlFragments(db: DatabaseSync, table: string, fragments: string[]): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string | null } | undefined;
  const sql = String(row?.sql ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const fragment of fragments) {
    if (!sql.includes(fragment.toLowerCase())) {
      fail(`missing_constraint:${table}:${fragment}`);
    }
  }
}

function ensureStateProjectionColumn(db: DatabaseSync): void {
  const present = columns(db, "cognitive_maturation_contract_state");
  if (!present.has("state")) {
    db.exec(
      `ALTER TABLE cognitive_maturation_contract_state
       ADD COLUMN state TEXT NOT NULL DEFAULT 'observe'
       CHECK (state IN ('observe', 'dark_apply', 'apply'))`,
    );
  }
  db.exec(
    `UPDATE cognitive_maturation_contract_state
     SET state = CASE
       WHEN cutover_or_activation_state IN ('observe', 'dark_apply', 'apply')
       THEN cutover_or_activation_state
       ELSE 'observe'
     END
     WHERE wave = 'c3'`,
  );
}

export function ensureNuclearV38Schema(db: DatabaseSync): void {
  const motivationsSql = String(db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motivations'",
  ).get()?.sql ?? "").toLowerCase();
  if (!motivationsSql.includes("learned_interest")) {
    db.exec(MIGRATION_38_MOTIVATIONS_KIND);
  }
  db.exec(MIGRATION_38_LEARNED_AUTONOMY_DDL);
  ensureStateProjectionColumn(db);
  db.prepare(
    `INSERT OR IGNORE INTO cognitive_maturation_contract_state
       (wave, highest_contract_version, live_authority_existed,
        event_highwater, cutover_or_activation_state, state)
     VALUES ('c3', ?, 0, 0, 'observe', 'observe')`,
  ).run(C3_CONTRACT_VERSION);
}

export function validateNuclearV38Schema(db: DatabaseSync, _version = 38): void {
  const required: Record<string, string[]> = {
    learned_influences: [
      "id", "entity_uuid", "owner_id", "kind", "subject_facet",
      "semantic_owner", "semantic_owner_ref", "lineage_kind",
      "influence_class", "text", "content_hash", "proposal_lifecycle",
      "adjudication_state", "adjudicator", "adjudication_decision_id",
      "qualified_at", "contradiction_state", "contradiction_reason",
      "demoted_at", "provenance", "capability_mode_at_write",
      "data_classification", "classification_source",
      "classification_invalidated_at", "created_at", "updated_at",
    ],
    learned_influence_evidence: [
      "id", "entity_uuid", "learned_influence_id", "owner_id",
      "evidence_type", "evidence_id", "assertion_id", "observed_at",
      "provenance", "data_classification", "source_content_hash", "created_at",
    ],
    learned_choice_receipts: [
      "receipt_id", "owner_id", "learned_id", "choice_kind",
      "candidate_ids_json", "selected_ids_json", "rank_delta_json",
      "policy_binding", "reason_code", "input_content_hash",
      "output_content_hash", "eligible_input_affected_ranking",
      "agency_made_final_choice", "data_classification", "created_at",
    ],
    identity_seed_lineage: [
      "id", "entity_uuid", "owner_id", "identity_entry_id", "disposition",
      "seed_source", "created_at",
    ],
  };
  for (const table of C3_TABLES) {
    if (!tableExists(db, table)) fail(`missing_table:${table}`);
    requireColumns(db, table, required[table] ?? []);
  }
  for (const index of C3_INDEXES) {
    if (!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get(index)) fail(`missing_index:${index}`);
  }
  requireSqlFragments(db, "learned_influences", [
    "memory_evidence", "shared_projection", "dark_apply", "owner_corrected",
  ]);
  requireSqlFragments(db, "learned_influence_evidence", [
    "assertion", "live", "references memory_assertions",
  ]);
  requireSqlFragments(db, "learned_choice_receipts", [
    "curiosity_rank", "motivation_admission", "json_valid",
  ]);
  requireSqlFragments(db, "identity_seed_lineage", [
    "explicit_seed", "owner_designated", "historical_source",
  ]);
  requireColumns(db, "cognitive_maturation_contract_state", ["state"]);
  const marker = db.prepare(
    `SELECT highest_contract_version, live_authority_existed,
            cutover_or_activation_state, state
     FROM cognitive_maturation_contract_state WHERE wave = 'c3'`,
  ).get() as {
    highest_contract_version?: number;
    live_authority_existed?: number;
    cutover_or_activation_state?: string;
    state?: string;
  } | undefined;
  if (!marker) fail("missing_c3_marker_row");
  if (Number(marker.highest_contract_version ?? 0) < C3_CONTRACT_VERSION) {
    fail("c3_contract_version_too_old");
  }
  if (marker.live_authority_existed !== 0) {
    fail("unexpected_c3_live_authority");
  }
}

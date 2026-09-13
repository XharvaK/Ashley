import type { DatabaseSync } from "node:sqlite";

export const C5_CONTRACT_VERSION = 1;

export const C5_TABLES = [
  "relationship_projections",
  "interaction_contracts",
  "consent_records",
  "repair_proposals",
  "repair_evidence",
  "repair_adjudications",
] as const;

export const C5_INDEXES = [
  "idx_relationship_projections_owner_current",
  "idx_relationship_projections_owner_effective",
  "idx_interaction_contracts_owner_kind",
  "idx_interaction_contracts_proposal",
  "idx_consent_records_owner_grantor_scope",
  "idx_repair_proposals_owner_tension",
  "idx_repair_evidence_proposal",
  "idx_repair_adjudications_proposal",
] as const;

/** Additive columns on the v14 relationship tables introduced by C5. */
export const C5_EXISTING_TABLE_COLUMNS: Record<string, string[]> = {
  doc_reminders: ["provenance", "party_subject_scope"],
  ashley_self_commitments: ["provenance", "party_subject_scope", "decision_id"],
  mutual_commitments: [
    "provenance",
    "party_subject_scope",
    "ashley_decision_id",
    "ashley_confirmation_evidence_ref",
    "mutual_withdrawal_evidence_json",
  ],
  scheduled_proactive_messages: ["provenance", "party_subject_scope"],
  relational_tensions: [
    "provenance",
    "party_subject_scope",
    "decision_id",
    "repair_proposal_id",
  ],
  withdrawal_records: ["provenance", "party_subject_scope"],
  relationship_motivation_claims: ["provenance", "party_subject_scope"],
};

/** Additive C5 records. They preserve relationship evidence without adding a score. */
export const MIGRATION_40_RELATIONAL_GRADUATION_DDL = `
CREATE TABLE IF NOT EXISTS relationship_projections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('current_shared_culture', 'historical_as_of')),
  projection_policy_id TEXT NOT NULL,
  projection_policy_version INTEGER NOT NULL CHECK (projection_policy_version >= 1),
  source_bindings_json TEXT NOT NULL CHECK (json_valid(source_bindings_json)),
  source_watermark_json TEXT NOT NULL CHECK (json_valid(source_watermark_json)),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  party_subject_scope TEXT NOT NULL CHECK (length(trim(party_subject_scope)) BETWEEN 1 AND 200),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  supersedes_projection_id INTEGER REFERENCES relationship_projections(id),
  content_binding TEXT NOT NULL CHECK (length(trim(content_binding)) BETWEEN 1 AND 200),
  computed_at TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to)
);

CREATE TABLE IF NOT EXISTS interaction_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'owner_standing_instruction', 'ashley_standing_boundary',
    'mutual_contract', 'implicit_hypothesis'
  )),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'recorded', 'in_force', 'withdrawn', 'superseded',
    'proposed', 'bilaterally_evidenced', 'hypothesis'
  )),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  party_subject_scope TEXT NOT NULL CHECK (length(trim(party_subject_scope)) BETWEEN 1 AND 200),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  scope TEXT,
  audience TEXT,
  withdrawal_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(withdrawal_refs_json)),
  correction_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(correction_refs_json)),
  supersession_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supersession_refs_json)),
  identity_entry_id INTEGER REFERENCES identity_entries(id),
  identity_interval_version TEXT,
  proposal_id TEXT,
  owner_confirmation_evidence_ref TEXT,
  ashley_confirmation_evidence_ref TEXT,
  ashley_decision_id INTEGER REFERENCES decision_log(id),
  delivery_reference TEXT,
  typed_evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(typed_evidence_json)),
  uncertainty REAL CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)),
  adaptation_policy TEXT,
  text_hash TEXT,
  created_at TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to),
  CHECK (kind <> 'implicit_hypothesis' OR lifecycle_state = 'hypothesis'),
  CHECK (
    kind <> 'mutual_contract' OR lifecycle_state NOT IN ('bilaterally_evidenced', 'in_force') OR
    (proposal_id IS NOT NULL AND owner_confirmation_evidence_ref IS NOT NULL
      AND ashley_confirmation_evidence_ref IS NOT NULL
      AND ashley_decision_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  grantor_identity_role TEXT NOT NULL CHECK (grantor_identity_role IN ('doc', 'ashley')),
  grantee_or_consumer TEXT NOT NULL CHECK (length(trim(grantee_or_consumer)) BETWEEN 1 AND 200),
  scope TEXT NOT NULL CHECK (length(trim(scope)) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 500),
  evidence_or_decision_ref TEXT NOT NULL CHECK (length(trim(evidence_or_decision_ref)) BETWEEN 1 AND 300),
  classification TEXT NOT NULL CHECK (classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  granted_at TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  expires_at TEXT,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('grant', 'revoke', 'expire', 'supersede')),
  supersedes_consent_id INTEGER REFERENCES consent_records(id),
  created_at TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to),
  CHECK (expires_at IS NULL OR effective_from <= expires_at)
);

CREATE TABLE IF NOT EXISTS repair_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  tension_id INTEGER REFERENCES relational_tensions(id),
  proposal_origin TEXT NOT NULL CHECK (proposal_origin IN (
    'model', 'worker', 'deterministic_extractor', 'owner'
  )),
  proposal_decision_id INTEGER REFERENCES decision_log(id),
  text_hash TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'proposed', 'admitted', 'withdrawn', 'expired', 'adjudicated'
  )),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  party_subject_scope TEXT NOT NULL CHECK (length(trim(party_subject_scope)) BETWEEN 1 AND 200),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  repair_text TEXT NOT NULL CHECK (length(trim(repair_text)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repair_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  proposal_id INTEGER NOT NULL REFERENCES repair_proposals(id),
  owner_id TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  party_subject_scope TEXT NOT NULL CHECK (length(trim(party_subject_scope)) BETWEEN 1 AND 200),
  content_binding TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repair_adjudications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  proposal_id INTEGER NOT NULL REFERENCES repair_proposals(id),
  owner_id TEXT NOT NULL,
  adjudicating_decision_id INTEGER NOT NULL REFERENCES decision_log(id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'repaired', 'not_repaired', 'unresolved', 'withdrawn'
  )),
  host_validation_ok INTEGER NOT NULL CHECK (host_validation_ok IN (0, 1)),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  party_subject_scope TEXT NOT NULL CHECK (length(trim(party_subject_scope)) BETWEEN 1 AND 200),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  delivery_receipt_id TEXT,
  supersedes_adjudication_id INTEGER REFERENCES repair_adjudications(id),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_projections_owner_current
  ON relationship_projections (owner_id)
  WHERE kind = 'current_shared_culture' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_projections_owner_effective
  ON relationship_projections (owner_id, effective_from, effective_to, id);
CREATE INDEX IF NOT EXISTS idx_interaction_contracts_owner_kind
  ON interaction_contracts (owner_id, kind, lifecycle_state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_contracts_proposal
  ON interaction_contracts (owner_id, proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_records_owner_grantor_scope
  ON consent_records (owner_id, grantor_identity_role, scope, created_at, id);
CREATE INDEX IF NOT EXISTS idx_repair_proposals_owner_tension
  ON repair_proposals (owner_id, tension_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_repair_evidence_proposal
  ON repair_evidence (proposal_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_repair_adjudications_proposal
  ON repair_adjudications (proposal_id, created_at, id);

CREATE TRIGGER IF NOT EXISTS trg_relationship_projections_historical_immutable
BEFORE UPDATE ON relationship_projections
WHEN OLD.effective_to IS NOT NULL OR OLD.kind = 'historical_as_of'
BEGIN
  SELECT RAISE(ABORT, 'relationship_projection_historical_immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_relationship_projections_no_delete
BEFORE DELETE ON relationship_projections
BEGIN
  SELECT RAISE(ABORT, 'relationship_projection_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_consent_records_no_update
BEFORE UPDATE ON consent_records
BEGIN
  SELECT RAISE(ABORT, 'consent_record_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_consent_records_no_delete
BEFORE DELETE ON consent_records
BEGIN
  SELECT RAISE(ABORT, 'consent_record_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_repair_evidence_no_update
BEFORE UPDATE ON repair_evidence
BEGIN
  SELECT RAISE(ABORT, 'repair_evidence_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_repair_evidence_no_delete
BEFORE DELETE ON repair_evidence
BEGIN
  SELECT RAISE(ABORT, 'repair_evidence_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_repair_adjudications_no_update
BEFORE UPDATE ON repair_adjudications
BEGIN
  SELECT RAISE(ABORT, 'repair_adjudication_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_repair_adjudications_no_delete
BEFORE DELETE ON repair_adjudications
BEGIN
  SELECT RAISE(ABORT, 'repair_adjudication_append_only');
END;
`;

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  if (!columns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Additive metadata on v14 relationship rows used by C5 writers. */
function ensureRelationshipWriterColumns(db: DatabaseSync): void {
  const relationshipTables = [
    "doc_reminders",
    "ashley_self_commitments",
    "mutual_commitments",
    "scheduled_proactive_messages",
    "relational_tensions",
    "withdrawal_records",
    "relationship_motivation_claims",
  ];
  for (const table of relationshipTables) {
    addColumnIfMissing(
      db,
      table,
      "provenance",
      "TEXT NOT NULL DEFAULT 'shadow' CHECK (provenance IN ('shadow', 'live'))",
    );
    addColumnIfMissing(
      db,
      table,
      "party_subject_scope",
      "TEXT NOT NULL DEFAULT 'owner'",
    );
  }
  addColumnIfMissing(
    db,
    "ashley_self_commitments",
    "decision_id",
    "INTEGER REFERENCES decision_log(id)",
  );
  addColumnIfMissing(
    db,
    "mutual_commitments",
    "ashley_decision_id",
    "INTEGER REFERENCES decision_log(id)",
  );
  addColumnIfMissing(
    db,
    "mutual_commitments",
    "ashley_confirmation_evidence_ref",
    "TEXT",
  );
  addColumnIfMissing(
    db,
    "mutual_commitments",
    "mutual_withdrawal_evidence_json",
    "TEXT NOT NULL DEFAULT '[]'",
  );
  addColumnIfMissing(
    db,
    "relational_tensions",
    "decision_id",
    "INTEGER REFERENCES decision_log(id)",
  );
  addColumnIfMissing(
    db,
    "relational_tensions",
    "repair_proposal_id",
    "INTEGER REFERENCES repair_proposals(id)",
  );
}

export function ensureNuclearV40Schema(db: DatabaseSync): void {
  ensureRelationshipWriterColumns(db);
  db.exec(MIGRATION_40_RELATIONAL_GRADUATION_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO cognitive_maturation_contract_state
       (wave, highest_contract_version, live_authority_existed,
        event_highwater, cutover_or_activation_state, state)
     VALUES ('c5', ?, 0, 0, 'observe', 'observe')`,
  ).run(C5_CONTRACT_VERSION);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function fail(detail: string): never {
  throw new Error(`nuclear_schema_content_invalid:v40:${detail}`);
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

function requireIndex(db: DatabaseSync, index: string): void {
  if (!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(index)) fail(`missing_index:${index}`);
}

function requireTrigger(db: DatabaseSync, trigger: string): void {
  if (!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).get(trigger)) fail(`missing_trigger:${trigger}`);
}

export function validateNuclearV40Schema(db: DatabaseSync, _version = 40): void {
  const required: Record<string, string[]> = {
    relationship_projections: [
      "id", "entity_uuid", "owner_id", "kind", "projection_policy_id",
      "projection_policy_version", "source_bindings_json", "source_watermark_json",
      "data_classification", "provenance", "party_subject_scope", "effective_from",
      "effective_to", "supersedes_projection_id", "content_binding", "computed_at",
    ],
    interaction_contracts: [
      "id", "entity_uuid", "owner_id", "kind", "lifecycle_state",
      "data_classification", "provenance", "party_subject_scope", "evidence_refs_json",
      "effective_from", "effective_to", "scope", "audience", "withdrawal_refs_json",
      "correction_refs_json", "supersession_refs_json", "identity_entry_id",
      "identity_interval_version", "proposal_id", "owner_confirmation_evidence_ref",
      "ashley_confirmation_evidence_ref", "ashley_decision_id", "delivery_reference",
      "typed_evidence_json", "uncertainty", "adaptation_policy", "text_hash", "created_at",
    ],
    consent_records: [
      "id", "entity_uuid", "owner_id", "grantor_identity_role", "grantee_or_consumer",
      "scope", "purpose", "evidence_or_decision_ref", "classification", "granted_at",
      "effective_from", "effective_to", "expires_at", "event_kind", "supersedes_consent_id",
      "created_at",
    ],
    repair_proposals: [
      "id", "entity_uuid", "owner_id", "tension_id", "proposal_origin",
      "proposal_decision_id", "text_hash", "lifecycle_state", "data_classification",
      "provenance", "party_subject_scope", "evidence_refs_json", "repair_text", "created_at",
    ],
    repair_evidence: [
      "id", "entity_uuid", "proposal_id", "owner_id", "evidence_refs_json",
      "data_classification", "provenance", "party_subject_scope", "content_binding", "created_at",
    ],
    repair_adjudications: [
      "id", "entity_uuid", "proposal_id", "owner_id", "adjudicating_decision_id",
      "disposition", "host_validation_ok", "data_classification", "provenance",
      "party_subject_scope", "evidence_refs_json", "delivery_receipt_id",
      "supersedes_adjudication_id", "created_at",
    ],
  };
  for (const table of C5_TABLES) {
    if (!tableExists(db, table)) fail(`missing_table:${table}`);
    requireColumns(db, table, required[table] ?? []);
  }
  for (const [table, columnNames] of Object.entries(C5_EXISTING_TABLE_COLUMNS)) {
    requireColumns(db, table, columnNames);
  }
  for (const index of C5_INDEXES) requireIndex(db, index);
  requireSqlFragments(db, "relationship_projections", [
    "current_shared_culture", "historical_as_of", "json_valid", "provenance",
  ]);
  requireSqlFragments(db, "interaction_contracts", [
    "owner_standing_instruction", "ashley_standing_boundary", "mutual_contract",
    "implicit_hypothesis", "lifecycle_state", "json_valid",
  ]);
  requireSqlFragments(db, "consent_records", [
    "grantor_identity_role", "event_kind in ('grant', 'revoke', 'expire', 'supersede')",
  ]);
  requireSqlFragments(db, "repair_adjudications", [
    "adjudicating_decision_id", "unresolved", "json_valid",
  ]);
  for (const trigger of [
    "trg_relationship_projections_historical_immutable",
    "trg_relationship_projections_no_delete",
    "trg_consent_records_no_update",
    "trg_consent_records_no_delete",
    "trg_repair_evidence_no_update",
    "trg_repair_evidence_no_delete",
    "trg_repair_adjudications_no_update",
    "trg_repair_adjudications_no_delete",
  ]) requireTrigger(db, trigger);
  const marker = db.prepare(
    `SELECT highest_contract_version, live_authority_existed,
            cutover_or_activation_state, state
     FROM cognitive_maturation_contract_state WHERE wave = 'c5'`,
  ).get() as {
    highest_contract_version?: number;
    live_authority_existed?: number;
    cutover_or_activation_state?: string;
    state?: string;
  } | undefined;
  if (!marker) fail("missing_c5_marker_row");
  if (Number(marker.highest_contract_version ?? 0) < C5_CONTRACT_VERSION) {
    fail("c5_contract_version_too_old");
  }
  if (Number(marker.highest_contract_version ?? 0) > C5_CONTRACT_VERSION) {
    fail("c5_contract_version_unsupported");
  }
  if (marker.live_authority_existed !== 0) fail("unexpected_c5_live_authority");
}

import type { DatabaseSync } from "node:sqlite";

export const C4_CONTRACT_VERSION = 1;

export const C4_TABLES = [
  "cognitive_predictions",
  "cognitive_outcome_observations",
  "cognitive_outcome_adjudications",
  "working_view_links",
  "lived_experience_links",
  "thought_calibration_adjustments",
] as const;

export const C4_INDEXES = [
  "idx_cognitive_predictions_owner_created",
  "idx_cognitive_predictions_decision",
  "idx_cognitive_predictions_lifecycle",
  "idx_cognitive_outcome_observations_prediction",
  "idx_cognitive_outcome_adjudications_prediction",
  "idx_lived_experience_links_owner_created",
  "idx_thought_calibration_adjustments_owner_effective",
  "idx_thought_calibration_adjustments_prediction",
] as const;

/** Additive C4 records. They preserve cognitive evidence without storing CoT. */
export const MIGRATION_39_COGNITIVE_GRADUATION_DDL = `
CREATE TABLE IF NOT EXISTS cognitive_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  decision_id INTEGER REFERENCES decision_log(id),
  judgment_text TEXT NOT NULL CHECK (length(trim(judgment_text)) BETWEEN 1 AND 600),
  judgment_class TEXT NOT NULL CHECK (length(trim(judgment_class)) BETWEEN 1 AND 64),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  evidential_strength REAL NOT NULL CHECK (evidential_strength >= 0 AND evidential_strength <= 1),
  expected_observable_outcome TEXT NOT NULL
    CHECK (length(trim(expected_observable_outcome)) BETWEEN 1 AND 1000),
  expected_horizon TEXT NOT NULL CHECK (length(trim(expected_horizon)) BETWEEN 1 AND 128),
  model_route_receipt_id TEXT NOT NULL CHECK (length(trim(model_route_receipt_id)) BETWEEN 1 AND 200),
  working_view_assertion_id INTEGER REFERENCES memory_assertions(id),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'selected', 'awaiting_observation', 'observation_available', 'closed', 'abandoned'
  )),
  selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0, 1)),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  classification_source TEXT NOT NULL CHECK (classification_source IN (
    'copied', 'derived_most_restrictive'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (
    'observe', 'dark_apply', 'apply'
  )),
  policy_lineage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_lineage_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cognitive_outcome_observations (
  observation_id TEXT PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),
  observable_kind TEXT NOT NULL CHECK (length(trim(observable_kind)) BETWEEN 1 AND 64),
  observed_value_typed TEXT,
  observation_evidence_ref TEXT,
  observation_content_binding TEXT,
  operational_receipt_type TEXT,
  operational_receipt_id TEXT,
  observation_kind TEXT NOT NULL CHECK (observation_kind IN (
    'receipt_backed', 'missing', 'outcome_unknown'
  )),
  observed_at TEXT NOT NULL,
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  CHECK (
    observed_value_typed IS NOT NULL OR
    (observation_evidence_ref IS NOT NULL AND observation_content_binding IS NOT NULL) OR
    observation_kind IN ('missing', 'outcome_unknown')
  )
);

CREATE TABLE IF NOT EXISTS cognitive_outcome_adjudications (
  adjudication_id TEXT PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),
  observation_id TEXT NOT NULL REFERENCES cognitive_outcome_observations(observation_id),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'confirmed', 'contradicted', 'partial_support', 'unresolved'
  )),
  proposal_origin TEXT NOT NULL CHECK (proposal_origin IN (
    'model', 'worker', 'deterministic_extractor', 'owner'
  )),
  host_validation_ok INTEGER NOT NULL CHECK (host_validation_ok IN (0, 1)),
  adjudication_authority TEXT NOT NULL CHECK (adjudication_authority IN (
    'deterministic_compare', 'ashley_thought_reflection', 'owner_confirmed'
  )),
  adjudicating_decision_id INTEGER REFERENCES decision_log(id),
  comparator_policy_version TEXT,
  supersedes_adjudication_id TEXT REFERENCES cognitive_outcome_adjudications(adjudication_id),
  correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN (
    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',
    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'
  )),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  created_at TEXT NOT NULL,
  CHECK (
    (adjudication_authority = 'deterministic_compare' AND
      adjudicating_decision_id IS NULL AND comparator_policy_version IS NOT NULL) OR
    (adjudication_authority <> 'deterministic_compare' AND
      adjudicating_decision_id IS NOT NULL AND comparator_policy_version IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS working_view_links (
  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  link_role TEXT NOT NULL CHECK (length(trim(link_role)) BETWEEN 1 AND 64),
  PRIMARY KEY (prediction_id, assertion_id, link_role)
);

CREATE TABLE IF NOT EXISTS lived_experience_links (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  episode_id INTEGER REFERENCES episodes(id),
  prediction_id INTEGER REFERENCES cognitive_predictions(id),
  operational_ref TEXT NOT NULL CHECK (length(trim(operational_ref)) BETWEEN 1 AND 200),
  reflection_event_id INTEGER REFERENCES reflection_events(id),
  revision_id INTEGER REFERENCES learning_revisions(id),
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  validity_state TEXT NOT NULL DEFAULT 'active' CHECK (validity_state IN (
    'active', 'invalidated'
  )),
  invalidated_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (episode_id IS NOT NULL OR prediction_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS thought_calibration_adjustments (
  adjustment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),
  latest_admitted_adjudication_id TEXT NOT NULL
    REFERENCES cognitive_outcome_adjudications(adjudication_id),
  judgment_class TEXT NOT NULL CHECK (length(trim(judgment_class)) BETWEEN 1 AND 64),
  correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN (
    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',
    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'
  )),
  adjustment_kind TEXT NOT NULL CHECK (adjustment_kind IN (
    'increase_caution', 'decrease_caution', 'narrow_scope',
    'request_more_evidence', 'hold_for_review'
  )),
  effect_value REAL NOT NULL CHECK (effect_value >= -0.25 AND effect_value <= 0.25),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  data_classification TEXT NOT NULL CHECK (data_classification IN (
    'ordinary', 'sensitive', 'never_public', 'secret'
  )),
  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (
    'observe', 'dark_apply', 'apply'
  )),
  policy_lineage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_lineage_json)),
  admitting_decision_id INTEGER NOT NULL REFERENCES decision_log(id),
  future_thought_consumer TEXT NOT NULL CHECK (length(trim(future_thought_consumer)) BETWEEN 1 AND 64),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (
    'proposed', 'admitted', 'eligible_for_future_thought',
    'demoted', 'expired', 'contradicted', 'rolled_back_through_capability'
  )),
  created_at TEXT NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to)
);

CREATE INDEX IF NOT EXISTS idx_cognitive_predictions_owner_created
  ON cognitive_predictions (owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cognitive_predictions_decision
  ON cognitive_predictions (decision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cognitive_predictions_lifecycle
  ON cognitive_predictions (owner_id, lifecycle_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cognitive_outcome_observations_prediction
  ON cognitive_outcome_observations (prediction_id, observed_at, observation_id);
CREATE INDEX IF NOT EXISTS idx_cognitive_outcome_adjudications_prediction
  ON cognitive_outcome_adjudications (prediction_id, created_at, adjudication_id);
CREATE INDEX IF NOT EXISTS idx_lived_experience_links_owner_created
  ON lived_experience_links (owner_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_thought_calibration_adjustments_owner_effective
  ON thought_calibration_adjustments (owner_id, effective_from, adjustment_id);
CREATE INDEX IF NOT EXISTS idx_thought_calibration_adjustments_prediction
  ON thought_calibration_adjustments (prediction_id, effective_from, adjustment_id);

CREATE TRIGGER IF NOT EXISTS trg_cognitive_outcome_observations_no_update
BEFORE UPDATE ON cognitive_outcome_observations
BEGIN
  SELECT RAISE(ABORT, 'cognitive_observation_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_cognitive_outcome_observations_no_delete
BEFORE DELETE ON cognitive_outcome_observations
BEGIN
  SELECT RAISE(ABORT, 'cognitive_observation_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_cognitive_outcome_adjudications_no_update
BEFORE UPDATE ON cognitive_outcome_adjudications
BEGIN
  SELECT RAISE(ABORT, 'cognitive_adjudication_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_cognitive_outcome_adjudications_no_delete
BEFORE DELETE ON cognitive_outcome_adjudications
BEGIN
  SELECT RAISE(ABORT, 'cognitive_adjudication_append_only');
END;
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
  throw new Error(`nuclear_schema_content_invalid:v39:${detail}`);
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

export function ensureNuclearV39Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_39_COGNITIVE_GRADUATION_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO cognitive_maturation_contract_state
       (wave, highest_contract_version, live_authority_existed,
        event_highwater, cutover_or_activation_state, state)
     VALUES ('c4', ?, 0, 0, 'observe', 'observe')`,
  ).run(C4_CONTRACT_VERSION);
}

export function validateNuclearV39Schema(db: DatabaseSync, _version = 39): void {
  const required: Record<string, string[]> = {
    cognitive_predictions: [
      "id", "entity_uuid", "owner_id", "decision_id", "judgment_text",
      "judgment_class", "evidence_refs_json", "evidential_strength",
      "expected_observable_outcome", "expected_horizon", "model_route_receipt_id",
      "working_view_assertion_id", "lifecycle_state", "selected",
      "data_classification", "classification_source", "provenance",
      "capability_mode_at_write", "policy_lineage_json", "created_at",
    ],
    cognitive_outcome_observations: [
      "observation_id", "prediction_id", "observable_kind", "observed_value_typed",
      "observation_evidence_ref", "observation_content_binding",
      "operational_receipt_type", "operational_receipt_id", "observation_kind",
      "observed_at", "data_classification", "provenance",
    ],
    cognitive_outcome_adjudications: [
      "adjudication_id", "prediction_id", "observation_id", "disposition",
      "proposal_origin", "host_validation_ok", "adjudication_authority",
      "adjudicating_decision_id", "comparator_policy_version",
      "supersedes_adjudication_id", "correction_class", "data_classification",
      "provenance", "created_at",
    ],
    working_view_links: ["prediction_id", "assertion_id", "link_role"],
    lived_experience_links: [
      "id", "owner_id", "episode_id", "prediction_id", "operational_ref",
      "reflection_event_id", "revision_id", "data_classification", "provenance",
      "evidence_refs_json", "validity_state", "invalidated_at", "created_at",
    ],
    thought_calibration_adjustments: [
      "adjustment_id", "owner_id", "prediction_id", "latest_admitted_adjudication_id",
      "judgment_class", "correction_class", "adjustment_kind", "effect_value",
      "effective_from", "effective_to", "data_classification", "provenance",
      "capability_mode_at_write", "policy_lineage_json", "admitting_decision_id",
      "future_thought_consumer", "lifecycle_state", "created_at",
    ],
  };
  for (const table of C4_TABLES) {
    if (!tableExists(db, table)) fail(`missing_table:${table}`);
    requireColumns(db, table, required[table] ?? []);
  }
  for (const index of C4_INDEXES) requireIndex(db, index);
  requireSqlFragments(db, "cognitive_predictions", [
    "expected_horizon", "model_route_receipt_id", "json_valid",
  ]);
  requireSqlFragments(db, "cognitive_outcome_observations", [
    "outcome_unknown", "observation_content_binding",
  ]);
  requireSqlFragments(db, "cognitive_outcome_adjudications", [
    "partial_support", "ashley_thought_reflection",
  ]);
  requireSqlFragments(db, "thought_calibration_adjustments", [
    "eligible_for_future_thought", "effect_value",
  ]);
  for (const trigger of [
    "trg_cognitive_outcome_observations_no_update",
    "trg_cognitive_outcome_observations_no_delete",
    "trg_cognitive_outcome_adjudications_no_update",
    "trg_cognitive_outcome_adjudications_no_delete",
  ]) requireTrigger(db, trigger);
  const marker = db.prepare(
    `SELECT highest_contract_version, live_authority_existed,
            cutover_or_activation_state, state
     FROM cognitive_maturation_contract_state WHERE wave = 'c4'`,
  ).get() as {
    highest_contract_version?: number;
    live_authority_existed?: number;
    cutover_or_activation_state?: string;
    state?: string;
  } | undefined;
  if (!marker) fail("missing_c4_marker_row");
  if (Number(marker.highest_contract_version ?? 0) < C4_CONTRACT_VERSION) {
    fail("c4_contract_version_too_old");
  }
  if (marker.live_authority_existed !== 0) {
    fail("unexpected_c4_live_authority");
  }
}

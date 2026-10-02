import { restoreLegacyV55Objects } from "./legacy-v55.js";
// C4 objects captured from the A4 base nuclear v54. Test fixtures only.
import type { DatabaseSync } from "node:sqlite";
const objects = [
  {
    "type": "table",
    "name": "cognitive_predictions",
    "sql": "CREATE TABLE cognitive_predictions (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  entity_uuid TEXT NOT NULL UNIQUE,\n  owner_id TEXT NOT NULL,\n  decision_id INTEGER REFERENCES decision_log(id),\n  judgment_text TEXT NOT NULL CHECK (length(trim(judgment_text)) BETWEEN 1 AND 600),\n  judgment_class TEXT NOT NULL CHECK (length(trim(judgment_class)) BETWEEN 1 AND 64),\n  evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),\n  evidential_strength REAL NOT NULL CHECK (evidential_strength >= 0 AND evidential_strength <= 1),\n  expected_observable_outcome TEXT NOT NULL\n    CHECK (length(trim(expected_observable_outcome)) BETWEEN 1 AND 1000),\n  expected_horizon TEXT NOT NULL CHECK (length(trim(expected_horizon)) BETWEEN 1 AND 128),\n  model_route_receipt_id TEXT NOT NULL CHECK (length(trim(model_route_receipt_id)) BETWEEN 1 AND 200),\n  working_view_assertion_id INTEGER REFERENCES memory_assertions(id),\n  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (\n    'selected', 'awaiting_observation', 'observation_available', 'closed', 'abandoned'\n  )),\n  selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0, 1)),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  classification_source TEXT NOT NULL CHECK (classification_source IN (\n    'copied', 'derived_most_restrictive'\n  )),\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (\n    'observe', 'dark_apply', 'apply'\n  )),\n  policy_lineage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_lineage_json)),\n  created_at TEXT NOT NULL\n)"
  },
  {
    "type": "index",
    "name": "idx_cognitive_predictions_decision",
    "sql": "CREATE INDEX idx_cognitive_predictions_decision\n  ON cognitive_predictions (decision_id, created_at DESC)"
  },
  {
    "type": "index",
    "name": "idx_cognitive_predictions_lifecycle",
    "sql": "CREATE INDEX idx_cognitive_predictions_lifecycle\n  ON cognitive_predictions (owner_id, lifecycle_state, created_at DESC)"
  },
  {
    "type": "index",
    "name": "idx_cognitive_predictions_owner_created",
    "sql": "CREATE INDEX idx_cognitive_predictions_owner_created\n  ON cognitive_predictions (owner_id, created_at DESC, id DESC)"
  },
  {
    "type": "table",
    "name": "cognitive_outcome_observations",
    "sql": "CREATE TABLE cognitive_outcome_observations (\n  observation_id TEXT PRIMARY KEY,\n  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),\n  observable_kind TEXT NOT NULL CHECK (length(trim(observable_kind)) BETWEEN 1 AND 64),\n  observed_value_typed TEXT,\n  observation_evidence_ref TEXT,\n  observation_content_binding TEXT,\n  operational_receipt_type TEXT,\n  operational_receipt_id TEXT,\n  observation_kind TEXT NOT NULL CHECK (observation_kind IN (\n    'receipt_backed', 'missing', 'outcome_unknown'\n  )),\n  observed_at TEXT NOT NULL,\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  CHECK (\n    observed_value_typed IS NOT NULL OR\n    (observation_evidence_ref IS NOT NULL AND observation_content_binding IS NOT NULL) OR\n    observation_kind IN ('missing', 'outcome_unknown')\n  )\n)"
  },
  {
    "type": "index",
    "name": "idx_cognitive_outcome_observations_prediction",
    "sql": "CREATE INDEX idx_cognitive_outcome_observations_prediction\n  ON cognitive_outcome_observations (prediction_id, observed_at, observation_id)"
  },
  {
    "type": "trigger",
    "name": "trg_cognitive_outcome_observations_no_delete",
    "sql": "CREATE TRIGGER trg_cognitive_outcome_observations_no_delete\nBEFORE DELETE ON cognitive_outcome_observations\nBEGIN\n  SELECT RAISE(ABORT, 'cognitive_observation_append_only');\nEND"
  },
  {
    "type": "trigger",
    "name": "trg_cognitive_outcome_observations_no_update",
    "sql": "CREATE TRIGGER trg_cognitive_outcome_observations_no_update\nBEFORE UPDATE ON cognitive_outcome_observations\nBEGIN\n  SELECT RAISE(ABORT, 'cognitive_observation_append_only');\nEND"
  },
  {
    "type": "table",
    "name": "cognitive_outcome_adjudications",
    "sql": "CREATE TABLE cognitive_outcome_adjudications (\n  adjudication_id TEXT PRIMARY KEY,\n  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),\n  observation_id TEXT NOT NULL REFERENCES cognitive_outcome_observations(observation_id),\n  disposition TEXT NOT NULL CHECK (disposition IN (\n    'confirmed', 'contradicted', 'partial_support', 'unresolved'\n  )),\n  proposal_origin TEXT NOT NULL CHECK (proposal_origin IN (\n    'model', 'worker', 'deterministic_extractor', 'owner'\n  )),\n  host_validation_ok INTEGER NOT NULL CHECK (host_validation_ok IN (0, 1)),\n  adjudication_authority TEXT NOT NULL CHECK (adjudication_authority IN (\n    'deterministic_compare', 'ashley_thought_reflection', 'owner_confirmed'\n  )),\n  adjudicating_decision_id INTEGER REFERENCES decision_log(id),\n  comparator_policy_version TEXT,\n  supersedes_adjudication_id TEXT REFERENCES cognitive_outcome_adjudications(adjudication_id),\n  correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN (\n    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',\n    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'\n  )),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  created_at TEXT NOT NULL,\n  CHECK (\n    (adjudication_authority = 'deterministic_compare' AND\n      adjudicating_decision_id IS NULL AND comparator_policy_version IS NOT NULL) OR\n    (adjudication_authority <> 'deterministic_compare' AND\n      adjudicating_decision_id IS NOT NULL AND comparator_policy_version IS NULL)\n  )\n)"
  },
  {
    "type": "index",
    "name": "idx_cognitive_outcome_adjudications_prediction",
    "sql": "CREATE INDEX idx_cognitive_outcome_adjudications_prediction\n  ON cognitive_outcome_adjudications (prediction_id, created_at, adjudication_id)"
  },
  {
    "type": "trigger",
    "name": "trg_cognitive_outcome_adjudications_no_delete",
    "sql": "CREATE TRIGGER trg_cognitive_outcome_adjudications_no_delete\nBEFORE DELETE ON cognitive_outcome_adjudications\nBEGIN\n  SELECT RAISE(ABORT, 'cognitive_adjudication_append_only');\nEND"
  },
  {
    "type": "trigger",
    "name": "trg_cognitive_outcome_adjudications_no_update",
    "sql": "CREATE TRIGGER trg_cognitive_outcome_adjudications_no_update\nBEFORE UPDATE ON cognitive_outcome_adjudications\nBEGIN\n  SELECT RAISE(ABORT, 'cognitive_adjudication_append_only');\nEND"
  },
  {
    "type": "table",
    "name": "working_view_links",
    "sql": "CREATE TABLE working_view_links (\n  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),\n  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),\n  link_role TEXT NOT NULL CHECK (length(trim(link_role)) BETWEEN 1 AND 64),\n  PRIMARY KEY (prediction_id, assertion_id, link_role)\n)"
  },
  {
    "type": "table",
    "name": "lived_experience_links",
    "sql": "CREATE TABLE \"lived_experience_links\" (\n      id TEXT PRIMARY KEY,\n      owner_id TEXT NOT NULL,\n      episode_id INTEGER REFERENCES episodes(id),\n      prediction_id INTEGER REFERENCES cognitive_predictions(id),\n      operational_ref TEXT NOT NULL CHECK (length(trim(operational_ref)) BETWEEN 1 AND 200),\n      reflection_event_id INTEGER REFERENCES reflection_events(id),\n      revision_id INTEGER,\n      data_classification TEXT NOT NULL CHECK (data_classification IN ('ordinary', 'sensitive', 'never_public', 'secret')),\n      provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n      evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),\n      validity_state TEXT NOT NULL DEFAULT 'active' CHECK (validity_state IN ('active', 'invalidated')),\n      invalidated_at TEXT,\n      created_at TEXT NOT NULL,\n      CHECK (episode_id IS NOT NULL OR prediction_id IS NOT NULL)\n    )"
  },
  {
    "type": "index",
    "name": "idx_lived_experience_links_owner_created",
    "sql": "CREATE INDEX idx_lived_experience_links_owner_created\n  ON lived_experience_links (owner_id, created_at, id)"
  },
  {
    "type": "table",
    "name": "thought_calibration_adjustments",
    "sql": "CREATE TABLE thought_calibration_adjustments (\n  adjustment_id TEXT PRIMARY KEY,\n  owner_id TEXT NOT NULL,\n  prediction_id INTEGER NOT NULL REFERENCES cognitive_predictions(id),\n  latest_admitted_adjudication_id TEXT NOT NULL\n    REFERENCES cognitive_outcome_adjudications(adjudication_id),\n  judgment_class TEXT NOT NULL CHECK (length(trim(judgment_class)) BETWEEN 1 AND 64),\n  correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN (\n    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',\n    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'\n  )),\n  adjustment_kind TEXT NOT NULL CHECK (adjustment_kind IN (\n    'increase_caution', 'decrease_caution', 'narrow_scope',\n    'request_more_evidence', 'hold_for_review'\n  )),\n  effect_value REAL NOT NULL CHECK (effect_value >= -0.25 AND effect_value <= 0.25),\n  effective_from TEXT NOT NULL,\n  effective_to TEXT,\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (\n    'observe', 'dark_apply', 'apply'\n  )),\n  policy_lineage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(policy_lineage_json)),\n  admitting_decision_id INTEGER NOT NULL REFERENCES decision_log(id),\n  future_thought_consumer TEXT NOT NULL CHECK (length(trim(future_thought_consumer)) BETWEEN 1 AND 64),\n  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN (\n    'proposed', 'admitted', 'eligible_for_future_thought',\n    'demoted', 'expired', 'contradicted', 'rolled_back_through_capability'\n  )),\n  created_at TEXT NOT NULL,\n  CHECK (effective_to IS NULL OR effective_from < effective_to)\n)"
  },
  {
    "type": "index",
    "name": "idx_thought_calibration_adjustments_owner_effective",
    "sql": "CREATE INDEX idx_thought_calibration_adjustments_owner_effective\n  ON thought_calibration_adjustments (owner_id, effective_from, adjustment_id)"
  },
  {
    "type": "index",
    "name": "idx_thought_calibration_adjustments_prediction",
    "sql": "CREATE INDEX idx_thought_calibration_adjustments_prediction\n  ON thought_calibration_adjustments (prediction_id, effective_from, adjustment_id)"
  }
];
export function restoreLegacyV54Objects(db: DatabaseSync): void {
  restoreLegacyV55Objects(db);
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    for (const name of ["thought_calibration_adjustments","lived_experience_links","working_view_links","cognitive_outcome_adjudications","cognitive_outcome_observations","cognitive_predictions"]) db.exec(`DROP TABLE IF EXISTS ${name}`);
    for (const object of objects) db.exec(object.sql);
  } finally { db.exec("PRAGMA foreign_keys=ON"); }
}

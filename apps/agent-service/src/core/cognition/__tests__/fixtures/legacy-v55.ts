// Historical nuclear v55 C3/state objects; test-only restoration for upgrade witnesses.
import type { DatabaseSync } from "node:sqlite";
const fixture = {
  "objects": [
    {
      "type": "table",
      "name": "cognitive_maturation_contract_state",
      "tbl_name": "cognitive_maturation_contract_state",
      "sql": "CREATE TABLE cognitive_maturation_contract_state (\n  wave TEXT PRIMARY KEY CHECK (wave IN ('c1', 'c2', 'c3', 'c4', 'c5')),\n  highest_contract_version INTEGER NOT NULL CHECK (highest_contract_version >= 1),\n  live_authority_existed INTEGER NOT NULL DEFAULT 0\n    CHECK (live_authority_existed IN (0, 1)),\n  event_highwater INTEGER NOT NULL DEFAULT 0 CHECK (event_highwater >= 0),\n  cutover_or_activation_state TEXT NOT NULL\n, state TEXT NOT NULL DEFAULT 'observe'\n       CHECK (state IN ('observe', 'dark_apply', 'apply')))"
    },
    {
      "type": "table",
      "name": "identity_seed_lineage",
      "tbl_name": "identity_seed_lineage",
      "sql": "CREATE TABLE identity_seed_lineage (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  entity_uuid TEXT NOT NULL UNIQUE,\n  owner_id TEXT NOT NULL,\n  identity_entry_id INTEGER NOT NULL REFERENCES identity_entries(id),\n  disposition TEXT NOT NULL CHECK (disposition IN (\n    'retained', 'independently_reinterpreted', 'rejected'\n  )),\n  seed_source TEXT NOT NULL CHECK (seed_source IN (\n    'explicit_seed', 'owner_designated', 'historical', 'historical_source'\n  )),\n  created_at TEXT NOT NULL,\n  UNIQUE (owner_id, identity_entry_id)\n)"
    },
    {
      "type": "table",
      "name": "learned_choice_receipts",
      "tbl_name": "learned_choice_receipts",
      "sql": "CREATE TABLE learned_choice_receipts (\n  receipt_id TEXT PRIMARY KEY,\n  owner_id TEXT NOT NULL,\n  learned_id INTEGER NOT NULL REFERENCES learned_influences(id),\n  choice_kind TEXT NOT NULL CHECK (choice_kind IN (\n    'curiosity_rank', 'motivation_admission', 'thought_selection'\n  )),\n  candidate_ids_json TEXT NOT NULL CHECK (json_valid(candidate_ids_json)),\n  selected_ids_json TEXT NOT NULL CHECK (json_valid(selected_ids_json)),\n  rank_delta_json TEXT NOT NULL CHECK (json_valid(rank_delta_json)),\n  policy_binding TEXT NOT NULL,\n  reason_code TEXT NOT NULL,\n  input_content_hash TEXT NOT NULL,\n  output_content_hash TEXT NOT NULL,\n  eligible_input_affected_ranking INTEGER NOT NULL CHECK (\n    eligible_input_affected_ranking IN (0, 1)\n  ),\n  agency_made_final_choice INTEGER NOT NULL CHECK (\n    agency_made_final_choice IN (0, 1)\n  ),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  created_at TEXT NOT NULL\n)"
    },
    {
      "type": "table",
      "name": "learned_influence_evidence",
      "tbl_name": "learned_influence_evidence",
      "sql": "CREATE TABLE learned_influence_evidence (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  entity_uuid TEXT NOT NULL UNIQUE,\n  learned_influence_id INTEGER NOT NULL REFERENCES learned_influences(id),\n  owner_id TEXT NOT NULL,\n  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('assertion')),\n  evidence_id TEXT NOT NULL,\n  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),\n  observed_at TEXT NOT NULL,\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  source_content_hash TEXT,\n  created_at TEXT NOT NULL,\n  UNIQUE (learned_influence_id, evidence_type, evidence_id)\n)"
    },
    {
      "type": "table",
      "name": "learned_influences",
      "tbl_name": "learned_influences",
      "sql": "CREATE TABLE learned_influences (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  entity_uuid TEXT NOT NULL UNIQUE,\n  owner_id TEXT NOT NULL,\n  kind TEXT NOT NULL CHECK (kind IN ('interest')),\n  subject_facet TEXT NOT NULL CHECK (subject_facet IN (\n    'owner_model', 'external_verifiable', 'ashley_side', 'unknown'\n  )),\n  semantic_owner TEXT NOT NULL CHECK (semantic_owner IN (\n    'memory_evidence', 'identity', 'mind_state', 'thought', 'agency'\n  )),\n  semantic_owner_ref TEXT NOT NULL,\n  lineage_kind TEXT NOT NULL CHECK (lineage_kind IN (\n    'unknown', 'explicit_seed', 'owner_designated', 'observed_overlap',\n    'ashley_native'\n  )),\n  influence_class TEXT NOT NULL CHECK (influence_class IN ('I0', 'I1', 'I2', 'I3')),\n  text TEXT NOT NULL,\n  content_hash TEXT NOT NULL,\n  proposal_lifecycle TEXT NOT NULL CHECK (proposal_lifecycle IN (\n    'proposed', 'admitted_to_review', 'withdrawn', 'expired_as_proposal'\n  )),\n  adjudication_state TEXT NOT NULL CHECK (adjudication_state IN (\n    'pending', 'accepted', 'declined'\n  )),\n  adjudicator TEXT CHECK (adjudicator IS NULL OR adjudicator IN (\n    'thought', 'natural_owner'\n  )),\n  adjudication_decision_id TEXT,\n  qualified_at TEXT,\n  contradiction_state TEXT NOT NULL DEFAULT 'none' CHECK (contradiction_state IN (\n    'none', 'contradicted', 'superseded', 'demoted', 'expired',\n    'owner_corrected'\n  )),\n  contradiction_reason TEXT,\n  demoted_at TEXT,\n  provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),\n  capability_mode_at_write TEXT NOT NULL CHECK (capability_mode_at_write IN (\n    'observe', 'dark_apply', 'apply'\n  )),\n  data_classification TEXT NOT NULL CHECK (data_classification IN (\n    'ordinary', 'sensitive', 'never_public', 'secret'\n  )),\n  classification_source TEXT NOT NULL CHECK (classification_source IN (\n    'copied', 'derived_most_restrictive'\n  )),\n  classification_invalidated_at TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  CHECK (subject_facet <> 'shared_projection'),\n  CHECK (adjudication_state <> 'accepted' OR qualified_at IS NOT NULL),\n  CHECK (adjudication_state <> 'accepted' OR adjudicator IS NOT NULL),\n  CHECK (adjudication_state <> 'accepted' OR adjudication_decision_id IS NOT NULL)\n)"
    },
    {
      "type": "index",
      "name": "idx_cognitive_maturation_contract_state_wave",
      "tbl_name": "cognitive_maturation_contract_state",
      "sql": "CREATE INDEX idx_cognitive_maturation_contract_state_wave\n  ON cognitive_maturation_contract_state (wave)"
    },
    {
      "type": "index",
      "name": "idx_identity_seed_lineage_owner_entry",
      "tbl_name": "identity_seed_lineage",
      "sql": "CREATE INDEX idx_identity_seed_lineage_owner_entry\n  ON identity_seed_lineage (owner_id, identity_entry_id)"
    },
    {
      "type": "index",
      "name": "idx_learned_choice_receipts_learned_created",
      "tbl_name": "learned_choice_receipts",
      "sql": "CREATE INDEX idx_learned_choice_receipts_learned_created\n  ON learned_choice_receipts (learned_id, created_at DESC, receipt_id DESC)"
    },
    {
      "type": "index",
      "name": "idx_learned_choice_receipts_owner_created",
      "tbl_name": "learned_choice_receipts",
      "sql": "CREATE INDEX idx_learned_choice_receipts_owner_created\n  ON learned_choice_receipts (owner_id, created_at DESC, receipt_id DESC)"
    },
    {
      "type": "index",
      "name": "idx_learned_influence_evidence_assertion",
      "tbl_name": "learned_influence_evidence",
      "sql": "CREATE INDEX idx_learned_influence_evidence_assertion\n  ON learned_influence_evidence (assertion_id, learned_influence_id)"
    },
    {
      "type": "index",
      "name": "idx_learned_influence_evidence_learned",
      "tbl_name": "learned_influence_evidence",
      "sql": "CREATE INDEX idx_learned_influence_evidence_learned\n  ON learned_influence_evidence (learned_influence_id, observed_at, id)"
    },
    {
      "type": "index",
      "name": "idx_learned_influences_entity_uuid",
      "tbl_name": "learned_influences",
      "sql": "CREATE UNIQUE INDEX idx_learned_influences_entity_uuid\n  ON learned_influences (entity_uuid)"
    },
    {
      "type": "index",
      "name": "idx_learned_influences_owner_state",
      "tbl_name": "learned_influences",
      "sql": "CREATE INDEX idx_learned_influences_owner_state\n  ON learned_influences (owner_id, adjudication_state, contradiction_state, updated_at DESC)"
    }
  ],
  "rows": [
    {
      "wave": "c2",
      "highest_contract_version": 1,
      "live_authority_existed": 0,
      "event_highwater": 0,
      "cutover_or_activation_state": "observe",
      "state": "observe"
    },
    {
      "wave": "c3",
      "highest_contract_version": 1,
      "live_authority_existed": 0,
      "event_highwater": 0,
      "cutover_or_activation_state": "observe",
      "state": "observe"
    },
    {
      "wave": "c4",
      "highest_contract_version": 1,
      "live_authority_existed": 0,
      "event_highwater": 0,
      "cutover_or_activation_state": "observe",
      "state": "observe"
    },
    {
      "wave": "c5",
      "highest_contract_version": 1,
      "live_authority_existed": 0,
      "event_highwater": 0,
      "cutover_or_activation_state": "observe",
      "state": "observe"
    }
  ]
};
export function restoreLegacyV55Objects(db: DatabaseSync): void {
 db.exec("PRAGMA foreign_keys=OFF");
 try {
  for (const table of ["learned_choice_receipts","learned_influence_evidence","identity_seed_lineage","learned_influences","cognitive_maturation_contract_state","relationship_contract_state"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
  for (const object of fixture.objects.filter(o=>o.type==="table")) db.exec(object.sql);
  for (const object of fixture.objects.filter(o=>o.type!=="table")) db.exec(object.sql);
  for (const row of fixture.rows) {
   const keys=Object.keys(row); db.prepare(`INSERT INTO cognitive_maturation_contract_state (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...Object.values(row));
  }
 } finally { db.exec("PRAGMA foreign_keys=ON"); }
}

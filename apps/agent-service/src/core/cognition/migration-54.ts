import type { DatabaseSync } from "node:sqlite";

const REMOVED_TABLES = [
  "identity_reviews", "learning_revisions", "context_budget_policies",
  "context_allocation_receipts", "context_summary_projections",
] as const;

/** Called inside the nuclear migration protocol, with foreign keys disabled before BEGIN. */
export function ensureNuclearV54Schema(db: DatabaseSync): void {
  const views = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'view' AND sql LIKE '%lived_experience_links%'",
  ).all();
  if (views.length) throw new Error("nuclear_v54_unsupported_lived_experience_view");
  const objects = db.prepare(
    `SELECT sql FROM sqlite_master WHERE tbl_name = 'lived_experience_links'
       AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name`,
  ).all() as Array<{ sql: string }>;
  const before = db.prepare("SELECT COUNT(*) AS count FROM lived_experience_links").get() as { count: number };
  db.exec(`
    CREATE TABLE lived_experience_links_new (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      episode_id INTEGER REFERENCES episodes(id),
      prediction_id INTEGER REFERENCES cognitive_predictions(id),
      operational_ref TEXT NOT NULL CHECK (length(trim(operational_ref)) BETWEEN 1 AND 200),
      reflection_event_id INTEGER REFERENCES reflection_events(id),
      revision_id INTEGER,
      data_classification TEXT NOT NULL CHECK (data_classification IN ('ordinary', 'sensitive', 'never_public', 'secret')),
      provenance TEXT NOT NULL CHECK (provenance IN ('shadow', 'live')),
      evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
      validity_state TEXT NOT NULL DEFAULT 'active' CHECK (validity_state IN ('active', 'invalidated')),
      invalidated_at TEXT,
      created_at TEXT NOT NULL,
      CHECK (episode_id IS NOT NULL OR prediction_id IS NOT NULL)
    );
    INSERT INTO lived_experience_links_new
      (id, owner_id, episode_id, prediction_id, operational_ref, reflection_event_id,
       revision_id, data_classification, provenance, evidence_refs_json, validity_state, invalidated_at, created_at)
      SELECT id, owner_id, episode_id, prediction_id, operational_ref, reflection_event_id,
       revision_id, data_classification, provenance, evidence_refs_json, validity_state, invalidated_at, created_at
      FROM lived_experience_links;
    DROP TABLE lived_experience_links;
    ALTER TABLE lived_experience_links_new RENAME TO lived_experience_links;
  `);
  for (const object of objects) db.exec(object.sql);
  const after = db.prepare("SELECT COUNT(*) AS count FROM lived_experience_links").get() as { count: number };
  if (before.count !== after.count) throw new Error("nuclear_v54_lived_experience_row_count_changed");
  for (const table of REMOVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
  validateNuclearV54Schema(db);
}

export function validateNuclearV54Schema(db: DatabaseSync): void {
  for (const table of REMOVED_TABLES) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`nuclear_schema_content_invalid:v54:removed_table:${table}`);
    }
  }
  for (const table of ["evidence_links", "cognitive_maturation_contract_state"]) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
      throw new Error(`nuclear_schema_content_invalid:v54:missing_table:${table}`);
    }
  }
  if (db.prepare("PRAGMA foreign_key_list(lived_experience_links)").all().some((row) => row.table === "learning_revisions")) {
    throw new Error("nuclear_schema_content_invalid:v54:legacy_revision_fk");
  }
}

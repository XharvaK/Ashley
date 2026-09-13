import type { DatabaseSync } from "node:sqlite";
import { legacyEntityUuid, newEntityUuid } from "./entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

/** Tables that receive entity_uuid + data_classification (v13+). */
export const TARGETABLE_TABLES: Array<{
  table: string;
  idColumn: string;
  ownerColumn: string | null;
  needsClassification: boolean;
}> = [
  { table: "mem_messages", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "mem_facts", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "episodes", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "identity_entries", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "opinions", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "questions", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "motivations", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "mind_state_items", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "decision_log", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "learning_revisions", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "initiative_reservations", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "cognitive_jobs", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "cognitive_runs", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "open_cognitive_items", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "cur_reads", idColumn: "id", ownerColumn: null, needsClassification: true },
  { table: "cur_takes", idColumn: "id", ownerColumn: null, needsClassification: true },
  { table: "delivery_reservations", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "delivery_bubbles", idColumn: "id", ownerColumn: null, needsClassification: true },
  { table: "delivery_auxiliary_messages", idColumn: "id", ownerColumn: null, needsClassification: true },
  { table: "reflection_events", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "doc_reminders", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "ashley_self_commitments", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "mutual_commitments", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "scheduled_proactive_messages", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "relational_tensions", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "withdrawal_records", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "relationship_motivation_claims", idColumn: "id", ownerColumn: "owner_id", needsClassification: false },
  { table: "perception_artifacts", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "conversational_reads", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "change_proposals", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "change_proposal_events", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "external_actions", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "external_action_events", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "external_entity_notes", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "vault_credential_index", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "sandbox_approval_proposals", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "sandbox_approval_events", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "candidate_changesets", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "candidate_changeset_events", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "bounded_operation_tasks", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "bounded_operation_steps", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "patch_export_records", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "operational_jobs", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
  { table: "operational_job_deliveries", idColumn: "id", ownerColumn: null, needsClassification: true },
  { table: "verification_receipts", idColumn: "id", ownerColumn: "owner_id", needsClassification: true },
];

export const RELATIONSHIP_ENTITY_TYPES = [
  "doc_reminder",
  "ashley_self_commitment",
  "mutual_commitment",
  "scheduled_proactive",
  "relational_tension",
  "withdrawal",
  "relationship_motivation_claim",
] as const;

export type RelationshipEntityType = (typeof RELATIONSHIP_ENTITY_TYPES)[number];

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name);
  return row !== undefined;
}

function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
}

export function ensureEntityUuidAndClassification(
  db: DatabaseSync,
  lineageId: string,
): void {
  const unclassified = defaultUnclassifiedConversational();
  for (const spec of TARGETABLE_TABLES) {
    if (!tableExists(db, spec.table)) continue;
    const cols = columnNames(db, spec.table);
    if (!cols.has("entity_uuid")) {
      db.exec(`ALTER TABLE ${spec.table} ADD COLUMN entity_uuid TEXT`);
    }
    if (spec.needsClassification && !cols.has("data_classification")) {
      db.exec(
        `ALTER TABLE ${spec.table} ADD COLUMN data_classification TEXT`,
      );
    }
    const rows = db
      .prepare(
        `SELECT ${spec.idColumn} AS id FROM ${spec.table} WHERE entity_uuid IS NULL`,
      )
      .all() as Array<{ id: number }>;
    const updateUuid = db.prepare(
      `UPDATE ${spec.table} SET entity_uuid = ? WHERE ${spec.idColumn} = ?`,
    );
    for (const row of rows) {
      updateUuid.run(
        legacyEntityUuid(lineageId, spec.table, row.id),
        row.id,
      );
    }
    if (spec.needsClassification) {
      db.prepare(
        `UPDATE ${spec.table}
         SET data_classification = ?
         WHERE data_classification IS NULL OR data_classification = ''`,
      ).run(unclassified);
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${spec.table}_entity_uuid
       ON ${spec.table} (entity_uuid)`,
    );
  }

  if (!tableExists(db, "lineage_mirror")) {
    db.exec(`
      CREATE TABLE lineage_mirror (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lineage_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
  const mirror = db
    .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  const now = new Date().toISOString();
  if (!mirror) {
    db.prepare(
      `INSERT INTO lineage_mirror (id, lineage_id, updated_at) VALUES (1, ?, ?)`,
    ).run(lineageId, now);
  } else if (mirror.lineage_id !== lineageId) {
    const err = new Error("continuity_lineage_mismatch") as Error & { code: string };
    err.code = "continuity_lineage_mismatch";
    throw err;
  }

  const receiptCols = columnNames(db, "forget_receipts");
  if (!receiptCols.has("tombstone_id")) {
    db.exec(`ALTER TABLE forget_receipts ADD COLUMN tombstone_id TEXT`);
  }
  if (!receiptCols.has("category_counts_json")) {
    db.exec(
      `ALTER TABLE forget_receipts ADD COLUMN category_counts_json TEXT NOT NULL DEFAULT '{}'`,
    );
  }
  if (!receiptCols.has("external_non_erasure_json")) {
    db.exec(
      `ALTER TABLE forget_receipts ADD COLUMN external_non_erasure_json TEXT NOT NULL DEFAULT '{}'`,
    );
  }
}

export function assignNewEntityUuid(): string {
  return newEntityUuid();
}

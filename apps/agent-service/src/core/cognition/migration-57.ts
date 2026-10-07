import type { DatabaseSync } from "node:sqlite";
import {
  CHANGE_PROPOSAL_INDEXES,
  CHANGE_PROPOSAL_TABLES,
} from "./legacy-change-proposal-migration-16.js";

/** Preflight runs before continuity writes as well as before any nuclear DDL. */
export function assertChangeProposalTablesEmpty(db: DatabaseSync): void {
  for (const table of CHANGE_PROPOSAL_TABLES) {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table);
    // Historical rewinds set an older user_version after v57 has already removed the table.
    if (!exists) continue;
    const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!;
    if (Number(row.n) !== 0) throw new Error(`change_proposal_rows_present:${table}:${row.n}`);
  }
}

export function ensureNuclearV57Schema(db: DatabaseSync): void {
  assertChangeProposalTablesEmpty(db);
  for (const index of [...CHANGE_PROPOSAL_INDEXES].reverse()) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const table of [...CHANGE_PROPOSAL_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${table}`);
  validateNuclearV57Schema(db);
}

export function validateNuclearV57Schema(db: DatabaseSync): void {
  for (const table of CHANGE_PROPOSAL_TABLES) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
      throw new Error(`nuclear_schema_content_invalid:v57:removed_table:${table}`);
    }
  }
}

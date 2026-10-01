import type { DatabaseSync } from "node:sqlite";
import { C4_TABLES } from "./legacy-graduation-migration-38.js";

/** Preflight runs before continuity writes as well as before any nuclear DDL. */
export function assertC4TablesEmpty(db: DatabaseSync): void {
  for (const table of C4_TABLES) {
    const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!;
    if (Number(row.n) !== 0) throw new Error(`c4_rows_present:${table}:${row.n}`);
  }
}
export function ensureNuclearV55Schema(db: DatabaseSync): void {
  assertC4TablesEmpty(db);
  for (const table of [...C4_TABLES].reverse()) db.exec(`DROP TABLE ${table}`);
  validateNuclearV55Schema(db);
}
export function validateNuclearV55Schema(db: DatabaseSync): void {
  for (const table of C4_TABLES) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`nuclear_schema_content_invalid:v55:removed_table:${table}`);
  }
  const marker = db.prepare("SELECT highest_contract_version,live_authority_existed FROM cognitive_maturation_contract_state WHERE wave='c4'").get();
  if (!marker || Number(marker.highest_contract_version) < 1 || Number(marker.live_authority_existed) !== 0) throw new Error("nuclear_schema_content_invalid:v55:c4_marker");
}

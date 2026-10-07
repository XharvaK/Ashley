import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { getContinuityFor } from "../continuity/registry.js";
import { validateNuclearSchemaContent } from "./schema-contract.js";
import { MIGRATION_16_CHANGE_PROPOSAL_DDL } from "./legacy-change-proposal-migration-16.js";
import { validateNuclearV57Schema } from "./migration-57.js";

const tables = ["change_proposals", "change_proposal_events"] as const;

function legacy(db: DatabaseSync) {
  db.exec(MIGRATION_16_CHANGE_PROPOSAL_DDL);
  db.exec("PRAGMA user_version = 56");
  getContinuityFor(db)!.exec("UPDATE lineage_state SET nuclear_schema_version = 56 WHERE id = 1");
}

function objects(db: DatabaseSync) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
}

function tableExists(db: DatabaseSync, name: string) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

describe("nuclear v57 change-proposal retirement", () => {
  it("ends a fresh database at v57 without the change-proposal tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(57);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 57 });
      for (const table of tables) expect(tableExists(db, table)).toBeUndefined();
      expect(() => validateNuclearV57Schema(db)).not.toThrow();
      expect(() => validateNuclearSchemaContent(db, 57)).not.toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it("drops empty change-proposal tables and passes the v57 validator", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      legacy(db);
      for (const table of tables) expect(tableExists(db, table)).toEqual({ name: table });
      openNuclearDb(db);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 57 });
      for (const table of tables) expect(tableExists(db, table)).toBeUndefined();
      expect(() => validateNuclearV57Schema(db)).not.toThrow();
      expect(() => validateNuclearSchemaContent(db, 57)).not.toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });

  it.each(tables)("stops before any drop when %s has a row", (table) => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      legacy(db);
      db.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().filter((row) => Number(row.notnull) === 1 || Number(row.pk) === 1);
      const values = cols.map((row) => /INT|REAL/i.test(String(row.type)) ? 1 : "fixture");
      db.prepare(`INSERT INTO ${table} (${cols.map((row) => row.name).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...values);
      db.exec("PRAGMA ignore_check_constraints=OFF; PRAGMA foreign_keys=ON");
      const before = objects(db);
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      const continuity = getContinuityFor(db)!;
      const lineage = continuity.prepare("SELECT * FROM lineage_state").all();
      expect(() => openNuclearDb(db)).toThrow(`change_proposal_rows_present:${table}:1`);
      expect(objects(db)).toEqual(before);
      for (const name of tables) expect(tableExists(db, name)).toEqual({ name });
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 56 });
      expect(continuity.prepare("SELECT * FROM lineage_state").all()).toEqual(lineage);
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally { db.close(); }
  });
});

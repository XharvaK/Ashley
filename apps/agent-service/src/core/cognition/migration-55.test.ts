import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { getContinuityFor } from "../continuity/registry.js";
import { restoreLegacyV54Objects } from "./__tests__/fixtures/legacy-v54.js";
const tables = ["cognitive_predictions", "cognitive_outcome_observations", "cognitive_outcome_adjudications", "working_view_links", "lived_experience_links", "thought_calibration_adjustments"];
function legacy(db: DatabaseSync) {
  restoreLegacyV54Objects(db); db.exec("PRAGMA user_version=54");
  getContinuityFor(db)!.exec("UPDATE lineage_state SET nuclear_schema_version=54 WHERE id=1");
}
function objects(db: DatabaseSync) { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all(); }
describe("nuclear v55 C4 retirement", () => {
  it("upgrades a fresh database and keeps the c4 contract marker", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(55);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 55 });
      for (const table of tables) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeUndefined();
      expect(db.prepare("SELECT highest_contract_version,state FROM cognitive_maturation_contract_state WHERE wave='c4'").get()).toEqual({ highest_contract_version: 1, state: "observe" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("upgrades an empty legacy v54 without changing non-C4 records", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      legacy(db);
      const marker = db.prepare("SELECT * FROM cognitive_maturation_contract_state ORDER BY wave").all();
      openNuclearDb(db);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 55 });
      expect(db.prepare("SELECT * FROM cognitive_maturation_contract_state ORDER BY wave").all()).toEqual(marker);
      for (const table of tables) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeUndefined();
    } finally { db.close(); }
  });
  it.each(tables)("stops before any drop when %s has rows", table => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      legacy(db);
      // An isolated legacy row deliberately has no parents: row presence must stop even damaged legacy state.
      db.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().filter(row => Number(row.notnull) === 1 || Number(row.pk) === 1);
      const values = cols.map(row => /INT|REAL/i.test(String(row.type)) ? 1 : "fixture");
      db.prepare(`INSERT INTO ${table} (${cols.map(row => row.name).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...values);
      db.exec("PRAGMA ignore_check_constraints=OFF; PRAGMA foreign_keys=ON");
      const before = objects(db); const rows = db.prepare(`SELECT * FROM ${table}`).all();
      const continuity = getContinuityFor(db)!;
      const lineage = continuity.prepare("SELECT * FROM lineage_state").all();
      expect(() => openNuclearDb(db)).toThrow(`c4_rows_present:${table}:1`);
      expect(objects(db)).toEqual(before);
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 54 });
      expect(continuity.prepare("SELECT * FROM lineage_state").all()).toEqual(lineage);
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally { db.close(); }
  });
});

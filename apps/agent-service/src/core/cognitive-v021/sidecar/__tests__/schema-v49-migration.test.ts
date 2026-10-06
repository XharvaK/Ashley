import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("GS1 sidecar v49", () => {
  it.each([false, true])("installs classification on fresh/upgrade (upgrade=%s)", (upgrade) => {
    const db = openTestSidecar();
    try {
      if (upgrade) {
        db.exec("ALTER TABLE sense_declines DROP COLUMN data_classification");
        db.exec("INSERT INTO sense_declines VALUES ('backup', 'considered', 'aging', 1, 2, NULL)");
        setTestSidecarVersion(db, 48);
        openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
        expect(db.prepare("SELECT data_classification FROM sense_declines").get()).toEqual({ data_classification: "ordinary" });
      }
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(67);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 67 });
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta").get()).toEqual({ schema_version: 67 });
      const column = db.prepare("PRAGMA table_info(sense_declines)").all().find(row => row.name === "data_classification");
      expect(column).toMatchObject({ notnull: 1, dflt_value: "'ordinary'" });
      for (const label of ["ordinary", "sensitive", "never_public", "secret"]) {
        db.prepare("INSERT OR REPLACE INTO sense_declines VALUES ('friction', 'considered', 'low', 1, 2, NULL, ?)").run(label);
      }
      expect(() => db.prepare("UPDATE sense_declines SET data_classification = 'invalid'").run()).toThrow();
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    } finally { db.close(); }
  });
});

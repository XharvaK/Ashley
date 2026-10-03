import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

const GROWTH_TABLES = ["growth_revisions", "growth_revision_evidence", "mood_state", "mood_events", "expectations"];

describe("cognitive sidecar schema v39", () => {
  it("adds the growth tables (revisions, mood, expectations) to a v38 sidecar", () => {
    const db = openTestSidecar();
    try {
      for (const table of GROWTH_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      setTestSidecarVersion(db, 38);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(60);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(60);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 60 });
      for (const table of GROWTH_TABLES) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table).toBeTruthy();
      }
      // Mood is one row: a second one is refused by the table itself.
      db.prepare("INSERT INTO mood_state (id, valence, energy, openness, tension, updated_at_ms) VALUES (1, 0, 0.5, 0.5, 0, 1)").run();
      expect(() => db.prepare("INSERT INTO mood_state (id, valence, energy, openness, tension, updated_at_ms) VALUES (2, 0, 0.5, 0.5, 0, 1)").run())
        .toThrow();
    } finally {
      db.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

const NIGHT_TABLES = ["night_state", "diary_entries", "self_narratives"];

describe("cognitive sidecar schema v40", () => {
  it("adds the NIGHT rhythm, diary, and narrative tables to a v39 sidecar", () => {
    const db = openTestSidecar();
    try {
      for (const table of NIGHT_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      setTestSidecarVersion(db, 39);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(60);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(60);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 60 });
      for (const table of NIGHT_TABLES) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table).toBeTruthy();
      }
      // The quiet hour is a real hour of the day.
      expect(() => db.prepare("INSERT INTO night_state (conversation_id, next_night_at_ms, quiet_hour, rhythm_started_at_ms, updated_at_ms) VALUES ('c', 1, 24, 1, 1)").run())
        .toThrow();
    } finally {
      db.close();
    }
  });
});

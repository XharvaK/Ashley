import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar schema v37", () => {
  it("adds episodes, thread stories, and the afterglow watermark when migrating from v36", () => {
    const db = openTestSidecar();
    try {
      for (const table of ["episodes_v2_fts", "episodes_v2", "thread_stories", "afterglow_state"]) {
        db.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      setTestSidecarVersion(db, 36);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      for (const table of ["episodes_v2", "episodes_v2_fts", "thread_stories", "afterglow_state"]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table).toBeTruthy();
      }
    } finally {
      db.close();
    }
  });
});

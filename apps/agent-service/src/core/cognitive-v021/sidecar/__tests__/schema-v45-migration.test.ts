import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar schema v45", () => {
  it("adds the persona snapshots table to a v44 sidecar", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE IF EXISTS persona_snapshots");
      setTestSidecarVersion(db, 44);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(55);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(55);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 55 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'persona_snapshots'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar schema v36", () => {
  it("adds memory_strength when migrating from v35", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE IF EXISTS memory_strength");
      setTestSidecarVersion(db, 35);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(68);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(68);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_strength'").get())
        .toBeTruthy();
    } finally {
      db.close();
    }
  });
});

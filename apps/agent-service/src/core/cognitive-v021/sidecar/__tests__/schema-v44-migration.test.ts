import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar schema v44", () => {
  it("adds the expectation basis table to a v43 sidecar", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE IF EXISTS expectation_basis");
      setTestSidecarVersion(db, 43);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(75);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(75);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 75 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'expectation_basis'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });
});

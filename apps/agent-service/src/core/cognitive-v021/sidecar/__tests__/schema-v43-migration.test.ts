import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar schema v43", () => {
  it("adds the forget proposals table to a v42 sidecar", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE IF EXISTS forget_proposals");
      setTestSidecarVersion(db, 42);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(71);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(71);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 71 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'forget_proposals'").get()).toBeTruthy();
      // A proposal is pending, confirmed or cancelled; nothing else.
      expect(() => db.prepare(
        `INSERT INTO forget_proposals (proposal_id, settlement_id, conversation_id, category_counts_json, status, created_at_ms, expires_at_ms)
         VALUES ('p', 's', 'c', '{}', 'erased', 1, 2)`,
      ).run()).toThrow();
    } finally {
      db.close();
    }
  });
});

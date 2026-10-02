import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V29 effect continuations", () => {
  it("creates the durable continuation table when migrating v28", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP INDEX IF EXISTS idx_effect_continuations_recovery");
      db.exec("DROP TABLE IF EXISTS effect_continuations");
      setTestSidecarVersion(db, 28);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(56);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 56 });
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get())
        .toMatchObject({ schema_version: 56 });
      expect(db.prepare("PRAGMA table_info(effect_continuations)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "effect_id" }),
        expect.objectContaining({ name: "deadline_at_ms" }),
        expect.objectContaining({ name: "remaining_effect_rounds" }),
        expect.objectContaining({ name: "completion_event_ref" }),
      ]));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_effect_continuations_recovery")).toEqual({ name: "idx_effect_continuations_recovery" });
    } finally {
      db.close();
    }
  });
});

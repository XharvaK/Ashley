import { describe, expect, it } from "vitest";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V34 migration", () => {
  it("adds bounded future-trigger evidence and timing columns idempotently", () => {
    const db = openTestSidecar();
    try {
      setTestSidecarVersion(db, 33);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(49);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(49);
      const columns = (db.prepare("PRAGMA table_info(future_triggers)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      expect(columns).toContain("evidence_refs_json");
      expect(columns).toContain("timing_policy");

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(49);
      expect((db.prepare("SELECT evidence_refs_json, timing_policy FROM future_triggers WHERE trigger_id = 'missing'").get())).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

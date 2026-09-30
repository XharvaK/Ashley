import { describe, expect, it } from "vitest";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";

describe("cognitive sidecar schema v28 effect diagnostics", () => {
  it("creates one conversation-bound, audience-scoped diagnostic row per effect", () => {
    const db = openTestSidecar();
    try {
      setTestSidecarVersion(db, 27);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      const columns = db.prepare("PRAGMA table_info(effect_diagnostics)").all() as Array<{ name: string }>;

      expect(version.user_version).toBe(42);
      expect(columns.map((column) => column.name)).toEqual([
        "diagnostic_id",
        "effect_id",
        "conversation_id",
        "cycle_id",
        "generation",
        "audience_scope_json",
        "data_classification",
        "secret_omitted",
        "diagnostic_json",
        "at_ms",
      ]);
    } finally {
      db.close();
    }
  });
});

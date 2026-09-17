import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V21 migration", () => {
  it("creates cognition_claims and is idempotent", () => {
    const db = openTestSidecar();
    try {
      db.exec("PRAGMA user_version = 20");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 20 WHERE id = 1").run();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(21);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(21);
      const columns = (db.prepare("PRAGMA table_info(cognition_claims)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      for (const column of [
        "conversation_id", "holder_event_id", "holder_wake_id", "cycle_id",
        "generation", "claim_token", "lease_expires_at_ms",
      ]) {
        expect(columns).toContain(column);
      }

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(21);
    } finally {
      db.close();
    }
  });
});

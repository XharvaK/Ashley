import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V20 migration", () => {
  it("creates operation_interim_outbox and is idempotent", () => {
    const db = openTestSidecar();
    try {
      db.exec("PRAGMA user_version = 20");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 20 WHERE id = 1").run();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(25);
      const columns = (db.prepare("PRAGMA table_info(operation_interim_outbox)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      for (const column of [
        "interim_id", "operation_id", "projection_key", "conversation_id",
        "cycle_id", "generation", "surface_draft", "presentation_directives_json",
        "send_status", "suppressed", "delivery_intent_json", "nuclear_reservation_id",
        "discord_message_id", "origin", "authorized_at_ms",
      ]) {
        expect(columns).toContain(column);
      }

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

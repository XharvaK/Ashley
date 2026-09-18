import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V19 migration", () => {
  it("preserves detached history while applying the global queue successor", () => {
    const db = openTestSidecar();
    try {
      db.exec("PRAGMA user_version = 19");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 19 WHERE id = 1").run();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(22);
      const columns = (db.prepare("PRAGMA table_info(detached_operations)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      for (const column of [
        "operation_id", "conversation_id", "origin_cycle_id", "origin_generation",
        "origin_owner_event_id", "operation_kind", "request_json", "purpose",
        "evidence_need", "admission_at_ms", "operation_deadline_at_ms",
        "idempotency_key", "state", "terminal_state", "interim_outbox_ref",
        "completion_event_ref", "cancel_requested_at_ms", "superseded_by",
        "successor_operation_id",
      ]) {
        expect(columns).toContain(column);
      }
      const indexes = (db.prepare("PRAGMA index_list(detached_operations)").all() as Array<{ name: string }>)
        .map((index) => index.name);
      expect(indexes).not.toContain("idx_detached_operations_active_conversation");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'worker_undertakings'").get())
        .toMatchObject({ name: "worker_undertakings" });

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

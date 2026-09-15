import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import {
  COGNITIVE_SIDECAR_SCHEMA_V1,
  COGNITIVE_SIDECAR_SCHEMA_V2,
  COGNITIVE_SIDECAR_SCHEMA_V3,
  COGNITIVE_SIDECAR_SCHEMA_V4,
  COGNITIVE_SIDECAR_SCHEMA_V5,
  COGNITIVE_SIDECAR_SCHEMA_V6,
  COGNITIVE_SIDECAR_SCHEMA_V7,
  COGNITIVE_SIDECAR_SCHEMA_V8,
  COGNITIVE_SIDECAR_SCHEMA_V9,
  COGNITIVE_SIDECAR_SCHEMA_V10,
  COGNITIVE_SIDECAR_SCHEMA_V11,
  COGNITIVE_SIDECAR_SCHEMA_V12,
  COGNITIVE_SIDECAR_SCHEMA_V13,
  COGNITIVE_SIDECAR_SCHEMA_V14,
} from "../schema.js";

function createV14Fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
  db.prepare(
    `INSERT INTO cognitive_sidecar_meta
       (id, schema_version, architecture_epoch, implementation_spec_version,
        thought_contract_version, authority_epoch)
     VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 2, 1)`,
  ).run();
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V4);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V5);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V6);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V7);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V8);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V9);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V10);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V11);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V12);
  db.exec(`
    DROP INDEX IF EXISTS idx_wakes_claim;
    DROP INDEX IF EXISTS idx_wakes_conversation;
    DROP TABLE wakes;
    ALTER TABLE wakes_v12 RENAME TO wakes;
    CREATE INDEX idx_wakes_claim ON wakes(state, lease_expires_at_ms, created_at_ms, wake_id);
    CREATE INDEX idx_wakes_conversation ON wakes(conversation_id, state, created_at_ms);
  `);
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 12 WHERE id = 1").run();
  db.exec("PRAGMA user_version = 12");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V14);
  db.exec("PRAGMA user_version = 14");
  return db;
}

describe("cognitive sidecar Schema V15/V16 migration", () => {
  it("creates the personal desk and external-watch columns exactly once when migrating V14", () => {
    const db = createV14Fixture();
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(16);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'desk_entries'").all())
        .toEqual([{ name: "desk_entries" }]);
      expect(db.prepare("PRAGMA table_info(desk_entries)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "id" }),
        expect.objectContaining({ name: "concern_ref" }),
        expect.objectContaining({ name: "body" }),
        expect.objectContaining({ name: "author_kind" }),
        expect.objectContaining({ name: "source_refs_json" }),
        expect.objectContaining({ name: "audience_scope_json" }),
        expect.objectContaining({ name: "lifecycle" }),
        expect.objectContaining({ name: "updated_generation" }),
      ]));
      expect(db.prepare("PRAGMA table_info(observation_subscriptions)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "external_source_type" }),
        expect.objectContaining({ name: "external_source_url_pattern" }),
        expect.objectContaining({ name: "poll_interval_ms" }),
        expect.objectContaining({ name: "expires_at_ms" }),
        expect.objectContaining({ name: "requester_id" }),
        expect.objectContaining({ name: "last_poll_outcome" }),
      ]));
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(16);
      expect(db.prepare("SELECT COUNT(*) AS count FROM desk_entries").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});

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
} from "../schema.js";

function createV7Fixture(): DatabaseSync {
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
  db.prepare(
    `INSERT INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status,
        state, first_attempt_at_ms, attempt_count)
     VALUES ('event:historical', 'conversation:historical', 'historical',
       '{}', 40, 'failed_retryable', 'retry_wait', 40, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO system_notice_outbox
       (notice_key, projection_key, cycle_id, conversation_id, notice_text,
        send_status, origin, delivery_intent_json)
     VALUES ('historical', 'system:historical', 'cycle:historical',
       'conversation:historical', 'notice', 'pending', 'live', '{}')`,
  ).run();
  db.prepare(
    `INSERT INTO deferred_reactive_frontiers
       (frontier_id, conversation_id, cycle_id, generation, state,
        next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
        attempt_count, created_at_ms, updated_at_ms)
     VALUES ('frontier:historical', 'conversation:historical', 'cycle:historical',
       1, 'exhausted', 10, 20, 'evidence:historical', 1, 30, 400)`,
  ).run();
  db.prepare(
    `INSERT INTO durable_work_attempts
       (attempt_id, event_id, ordinal, worker_id, started_at_ms, finished_at_ms,
        dispatch_truth, failure_class, error_code)
     VALUES ('attempt:historical', 'event:historical', 1, 'worker', 50, 500,
       'not_started', 'transient_retryable', 'age_exhausted')`,
  ).run();
  db.exec("PRAGMA user_version = 7");
  return db;
}

describe("cognitive sidecar Schema V8 migration", () => {
  it("migrates V7 with tri-partite version and cutover watermarks", () => {
    const db = createV7Fixture();
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      ).toBe(14);
      expect(
        db.prepare(
          "SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1",
        ).get(),
      ).toEqual({ schema_version: 14 });
      expect(
        (db.prepare("PRAGMA table_info(deferred_reactive_frontiers)").all() as Array<{ name: string }>)
          .map((column) => column.name),
      ).toContain("terminal_reason");
      expect(
        db.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('c3_terminal_experiences', 'c3_activation_cutover') ORDER BY name",
        ).all(),
      ).toEqual([
        { name: "c3_activation_cutover" },
        { name: "c3_terminal_experiences" },
      ]);
      expect(
        db.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_c3_exp_cycle', 'idx_c3_exp_unresolved') ORDER BY name",
        ).all(),
      ).toEqual([
        { name: "idx_c3_exp_cycle" },
        { name: "idx_c3_exp_unresolved" },
      ]);
      expect(
        db.prepare("SELECT * FROM c3_activation_cutover WHERE id = 1").get(),
      ).toMatchObject({
        max_pre_v8_notice_id: 1,
        max_pre_v8_frontier_updated_at_ms: 400,
        max_pre_v8_attempt_finished_at_ms: 500,
        max_pre_v8_delivery_reservation_id: null,
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent and keeps one cutover vocabulary", () => {
    const db = createV7Fixture();
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      const first = db.prepare("SELECT * FROM c3_activation_cutover WHERE id = 1").get();
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT COUNT(*) AS count FROM c3_activation_cutover").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT * FROM c3_activation_cutover WHERE id = 1").get()).toEqual(first);
      expect(
        (db.prepare("PRAGMA table_info(c3_activation_cutover)").all() as Array<{ name: string }>).map((column) => column.name),
      ).toEqual([
        "id",
        "activated_at_ms",
        "max_pre_v8_notice_id",
        "max_pre_v8_frontier_updated_at_ms",
        "max_pre_v8_attempt_finished_at_ms",
        "max_pre_v8_delivery_reservation_id",
      ]);
      expect(COGNITIVE_SIDECAR_SCHEMA_V8).not.toMatch(/DROP\s+TABLE/i);
    } finally {
      db.close();
    }
  });
});

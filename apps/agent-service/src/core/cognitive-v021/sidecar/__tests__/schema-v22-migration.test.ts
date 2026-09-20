import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_V19 } from "../schema.js";
import { admitDetachedOperation } from "../../operation/detached.js";
import { enqueueWorkerUndertaking } from "../../operation/worker-queue.js";

function makePopulatedV21Fixture() {
  const db = openTestSidecar();
  db.exec(`
    DROP INDEX IF EXISTS idx_detached_operations_active_conversation;
    DROP INDEX IF EXISTS idx_detached_operations_idempotency;
    DROP INDEX IF EXISTS idx_detached_operations_deadline;
    DROP INDEX IF EXISTS idx_detached_operations_capacity_wait;
    DROP TABLE IF EXISTS detached_operations;
    DROP INDEX IF EXISTS idx_worker_undertakings_queue;
    DROP INDEX IF EXISTS idx_worker_undertakings_conversation;
    DROP INDEX IF EXISTS idx_worker_undertakings_operation;
    DROP INDEX IF EXISTS idx_worker_undertakings_expiry;
    DROP TABLE IF EXISTS worker_undertakings;
    DROP TABLE IF EXISTS worker_undertaking_scheduler;
    DROP TABLE IF EXISTS worker_execution_slot;
  `);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V19);
  const deadline = Date.now() + 1_000_000;
  const rows = [
    { id: "v21-admitted", state: "admitted", startAt: null, startProof: null, terminal: null },
    { id: "v21-started", state: "started", startAt: 2_000, startProof: "v21-start-proof", terminal: null },
    { id: "v21-succeeded", state: "succeeded", startAt: 3_000, startProof: "v21-success-start", terminal: "succeeded" },
    { id: "v21-failed", state: "failed", startAt: 4_000, startProof: "v21-failed-start", terminal: "failed" },
    { id: "v21-unknown", state: "outcome_unknown", startAt: 5_000, startProof: "v21-unknown-start", terminal: "outcome_unknown" },
  ] as const;
  const insert = db.prepare(
    `INSERT INTO detached_operations (
       operation_id, conversation_id, origin_cycle_id, origin_generation,
       origin_owner_event_id, origin_evidence_row_id, operation_kind,
       request_json, purpose, evidence_need, admission_at_ms,
       operation_deadline_at_ms, idempotency_key, worker_binding_json,
       start_at_ms, start_proof_ref, terminal_state, terminal_at_ms,
       state, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, 1, ?, ?, 'project.investigate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  );
  for (const [index, row] of rows.entries()) {
    insert.run(
      row.id,
      `thread:${row.id}`,
      `cycle:${row.id}`,
      `owner-event:${row.id}`,
      `evidence:${row.id}`,
      JSON.stringify({ projectId: "project-ashley", focus: row.id }),
      `legacy ${row.id}`,
      "bounded legacy evidence",
      1_000 + index,
      deadline,
      `idempotency:${row.id}`,
      null,
      row.startAt,
      row.startProof,
      row.terminal,
      row.terminal ? 6_000 + index : null,
      row.state,
      1_000 + index,
      1_000 + index,
    );
  }
  db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 21 WHERE id = 1").run();
  db.exec("PRAGMA user_version = 21");
  return db;
}

describe("cognitive sidecar Schema V22 worker queue", () => {
  it("exposes the final queue, singleton slot, and typed detached origin schema", () => {
    const db = openTestSidecar();
    try {
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
        .toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect((db.prepare(
        "SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1",
      ).get() as { schema_version: number }).schema_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);

      const queueColumns = (db.prepare("PRAGMA table_info(worker_undertakings)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      expect(queueColumns).toEqual(expect.arrayContaining([
        "undertaking_id",
        "semantic_kind",
        "origin_kind",
        "origin_ref",
        "state",
        "blocked_reason",
        "curiosity_expires_at_ms",
        "selected_operation_id",
        "acknowledgement_ref",
      ]));
      expect(db.prepare("SELECT scheduler_id, cursor FROM worker_undertaking_scheduler WHERE scheduler_id = 1").get())
        .toMatchObject({ scheduler_id: 1, cursor: 0 });
      expect(db.prepare("SELECT slot_id, undertaking_id, operation_id FROM worker_execution_slot WHERE slot_id = 1").get())
        .toMatchObject({ slot_id: 1, undertaking_id: null, operation_id: null });

      const detachedColumns = (db.prepare("PRAGMA table_info(detached_operations)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      expect(detachedColumns).toEqual(expect.arrayContaining([
        "origin_kind",
        "origin_ref",
        "worker_undertaking_id",
        "capacity_wait_reason",
      ]));
      expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_detached_operations_active_conversation'",
      ).get()).toBeUndefined();
      expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_worker_undertakings_queue'",
      ).get()).toMatchObject({ name: "idx_worker_undertakings_queue" });
    } finally {
      db.close();
    }
  });

  it("maps populated V21 detached work into truthful queue ownership without rerunning started work", () => {
    const db = makePopulatedV21Fixture();
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT COUNT(*) AS count FROM worker_undertakings").get()).toMatchObject({ count: 5 });
      expect(db.prepare(
        `SELECT state, selected_operation_id FROM worker_undertakings
           WHERE selected_operation_id = 'v21-admitted'`,
      ).get()).toEqual({ state: "queued", selected_operation_id: "v21-admitted" });
      expect(db.prepare(
        `SELECT state, selected_operation_id FROM worker_undertakings
           WHERE selected_operation_id = 'v21-started'`,
      ).get()).toEqual({ state: "running", selected_operation_id: "v21-started" });
      expect(db.prepare(
        `SELECT state FROM worker_undertakings WHERE selected_operation_id = 'v21-succeeded'`,
      ).get()).toEqual({ state: "succeeded" });
      expect(db.prepare(
        `SELECT state FROM worker_undertakings WHERE selected_operation_id = 'v21-failed'`,
      ).get()).toEqual({ state: "failed" });
      expect(db.prepare(
        `SELECT state FROM worker_undertakings WHERE selected_operation_id = 'v21-unknown'`,
      ).get()).toEqual({ state: "outcome_unknown" });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM detached_operations WHERE worker_undertaking_id IS NULL",
      ).get()).toMatchObject({ count: 0 });
      expect(db.prepare(
        `SELECT state, start_proof_ref FROM detached_operations WHERE operation_id = 'v21-started'`,
      ).get()).toEqual({ state: "started", start_proof_ref: "v21-start-proof" });
      expect(db.prepare(
        `SELECT undertaking_id, operation_id FROM worker_execution_slot WHERE slot_id = 1`,
      ).get()).toEqual(expect.objectContaining({ operation_id: "v21-started" }));
    } finally {
      db.close();
    }
  });

  it("enforces origin truth and one-to-one queue/operation ownership at the database boundary", () => {
    const db = openTestSidecar();
    try {
      const owner = admitDetachedOperation(db, {
        idempotencyKey: "schema-v22:owner",
        conversationId: "thread:schema-v22",
        originCycleId: "cycle:schema-v22",
        originGeneration: 1,
        originKind: "OWNER_REQUEST",
        originRef: "owner:schema-v22",
        originOwnerEventId: "owner:schema-v22",
        operationKind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "schema constraint probe",
        evidenceNeed: "constraint behavior",
        operationDeadlineAtMs: 100_000,
        nowMs: 1,
      });
      const curiosity = admitDetachedOperation(db, {
        idempotencyKey: "schema-v22:curiosity",
        conversationId: "thread:schema-v22-curiosity",
        originCycleId: "cycle:schema-v22-curiosity",
        originGeneration: 1,
        originKind: "ASHLEY_CURIOSITY",
        originRef: "curiosity:schema-v22",
        operationKind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "schema constraint probe",
        evidenceNeed: "constraint behavior",
        operationDeadlineAtMs: 100_000,
        nowMs: 2,
      });
      expect(owner.ok).toBe(true);
      expect(curiosity.ok).toBe(true);
      if (!owner.ok || !curiosity.ok) return;

      expect(() => db.prepare(
        "UPDATE detached_operations SET origin_owner_event_id = 'owner:other' WHERE operation_id = ?",
      ).run(owner.operation.operationId)).toThrow();
      expect(() => db.prepare(
        "UPDATE detached_operations SET origin_owner_event_id = 'unexpected' WHERE operation_id = ?",
      ).run(curiosity.operation.operationId)).toThrow();

      expect(db.prepare(
        "UPDATE detached_operations SET worker_undertaking_id = 'worker:unique' WHERE operation_id = ?",
      ).run(owner.operation.operationId)).toMatchObject({ changes: 1 });
      expect(() => db.prepare(
        "UPDATE detached_operations SET worker_undertaking_id = 'worker:unique' WHERE operation_id = ?",
      ).run(curiosity.operation.operationId)).toThrow();

      const firstQueue = enqueueWorkerUndertaking(db, {
        semanticKind: "project.inspect",
        origin: { kind: "OWNER_REQUEST", ref: "owner:queue-unique-1", ownerEventId: "owner:queue-unique-1" },
        ownerId: "doc",
        conversationId: "thread:queue-unique",
        originCycleId: "cycle:queue-unique",
        originGeneration: 1,
        request: { projectId: "project-ashley" },
        purpose: "queue uniqueness probe",
        evidenceNeed: "queue uniqueness",
        nowMs: 3,
      });
      const secondQueue = enqueueWorkerUndertaking(db, {
        semanticKind: "project.inspect",
        origin: { kind: "OWNER_REQUEST", ref: "owner:queue-unique-2", ownerEventId: "owner:queue-unique-2" },
        ownerId: "doc",
        conversationId: "thread:queue-unique",
        originCycleId: "cycle:queue-unique",
        originGeneration: 1,
        request: { projectId: "project-ashley", focus: "second" },
        purpose: "queue uniqueness probe",
        evidenceNeed: "queue uniqueness",
        nowMs: 4,
      });
      expect(firstQueue.ok).toBe(true);
      expect(secondQueue.ok).toBe(true);
      if (!firstQueue.ok || !secondQueue.ok) return;
      expect(db.prepare(
        "UPDATE worker_undertakings SET selected_operation_id = 'detached-operation:unique' WHERE undertaking_id = ?",
      ).run(firstQueue.undertaking.undertakingId)).toMatchObject({ changes: 1 });
      expect(() => db.prepare(
        "UPDATE worker_undertakings SET selected_operation_id = 'detached-operation:unique' WHERE undertaking_id = ?",
      ).run(secondQueue.undertaking.undertakingId)).toThrow();
    } finally {
      db.close();
    }
  });

  it("fails closed when a pre-existing worker table is not the exact V22 contract", () => {
    const db = makePopulatedV21Fixture();
    try {
      db.exec("CREATE TABLE worker_undertakings (undertaking_id TEXT PRIMARY KEY)");
      expect(() => openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } }))
        .toThrow(/cognitive_sidecar_v22_incompatible_existing_queue/);
    } finally {
      db.close();
    }
  });
});

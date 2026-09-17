import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { reservedProductionCognitiveSidecarDbPath } from "../../data-plane.js";
import { admitWake } from "../wake/ledger.js";
import { reservePrivateThought } from "../private-budget/ledger.js";
import { openCognitiveSidecarDb, readCognitiveProjectionState } from "./db.js";
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
} from "./schema.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../types.js";

function fakeDatabaseWithMainFile(file: string): DatabaseSync {
  return {
    prepare: () => ({
      all: () => [{ name: "main", file }],
    }),
  } as unknown as DatabaseSync;
}

describe("cognitive v0.2.1 sidecar database", () => {
  it("creates the complete v12 schema on an isolated in-memory database", () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
      dataPlane: { kind: "isolated" },
    });

    expect(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
    expect(
      (
        db
          .prepare(
            "SELECT schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch FROM cognitive_sidecar_meta WHERE id = 1",
          )
          .get() as Record<string, unknown>
      ),
    ).toEqual({
      schema_version: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      architecture_epoch: "v0.2.1",
      implementation_spec_version: "0.2.1.r6",
      thought_contract_version: 2,
      authority_epoch: 1,
    });

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables).toHaveLength(41);
    expect(tables).toContain("speech_outbox");
    expect(tables).toContain("detached_operations");
    expect(tables).toContain("operation_interim_outbox");
    expect(tables).toContain("thought_attempt_counters");
    expect(tables).toContain("wakes");
    expect(tables).toContain("wake_legacy_quarantine");
    expect(tables).toContain("private_budget_reservations");
    expect(tables).toContain("private_budget_attempt_bindings");
    expect(tables).toContain("deferred_reactive_frontiers");
    // F0 V9: the consuming index is policy-scoped (no conversation_id lead).
    const indexColumns = (
      db.prepare("PRAGMA index_info(idx_private_budget_consuming)").all() as Array<{ seqno: number; cid: number; name: string }>
    ).sort((a, b) => a.seqno - b.seqno).map((column) => column.name);
    expect(indexColumns).toEqual(["policy_id", "policy_time_ms", "state"]);
    // P1 V11: singleton schedule + append-only receipts, no secondary index.
    const scheduleColumns = (
      db.prepare("PRAGMA table_info(periodic_cognition_schedule)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(scheduleColumns).toEqual([
      "id",
      "authority_epoch",
      "next_eligible_at_ms",
      "pending_occurrence_id",
      "pending_wake_id",
      "pending_due_at_ms",
      "pending_expires_at_ms",
      "updated_at_ms",
    ]);
    const receiptColumns = (
      db.prepare("PRAGMA table_info(periodic_cognition_occurrence_receipts)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(receiptColumns).toEqual([
      "schedule_occurrence_id",
      "disposition",
      "wake_id",
      "authority_epoch",
      "eligible_at_ms",
      "closed_at_ms",
      "detail",
    ]);
    expect(() => db.prepare(
      "INSERT INTO periodic_cognition_occurrence_receipts (schedule_occurrence_id, disposition, authority_epoch, eligible_at_ms, closed_at_ms) VALUES ('r', 'bogus', 1, 1, 1)",
    ).run()).toThrow();
    expect(() => db.prepare(
      "INSERT INTO periodic_cognition_schedule (id, authority_epoch, next_eligible_at_ms, updated_at_ms) VALUES ('other', 1, 1, 1)",
    ).run()).toThrow();
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'periodic_%' AND name NOT LIKE 'sqlite_autoindex%'").get() as { count: number }).count,
    ).toBe(0);
    db.close();
  });

  it("migrates wakes to v12 without changing rows or child foreign-key ownership", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
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
    db.prepare(
      `INSERT INTO wakes
         (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
          state, terminal_reason, captured_trigger_generation, captured_authority_revision,
          consequence_chain_id, lease_owner, lease_token, lease_expires_at_ms,
          cancellation_id, created_at_ms, updated_at_ms)
       VALUES ('wake:v11-preserve', 'occ:v11-preserve', 'trigger:v11-preserve', 'inbox',
          'conversation:v11-preserve', 'cycle:v11-preserve', 'terminal', 'expired', 4, 9,
          'chain:v11-preserve', NULL, NULL, NULL, 'cancel:v11-preserve', 10, 20)`,
    ).run();
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
       VALUES ('event:v11-child', 'conversation:v11-preserve', 'owner_message', '{}', 21, 'pending', 'wake:v11-preserve')`,
    ).run();
    db.exec("PRAGMA user_version = 11");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(db.prepare("SELECT * FROM wakes WHERE wake_id = 'wake:v11-preserve'").get()).toEqual({
        wake_id: "wake:v11-preserve",
        occurrence_id: "occ:v11-preserve",
        trigger_ref: "trigger:v11-preserve",
        source_kind: "inbox",
        conversation_id: "conversation:v11-preserve",
        cycle_id: "cycle:v11-preserve",
        state: "terminal",
        terminal_reason: "expired",
        captured_trigger_generation: 4,
        captured_authority_revision: 9,
        consequence_chain_id: "chain:v11-preserve",
        lease_owner: null,
        lease_token: null,
        lease_expires_at_ms: null,
        cancellation_id: "cancel:v11-preserve",
        created_at_ms: 10,
        updated_at_ms: 20,
      });
      expect((db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number }).schema_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA foreign_key_list(inbox_events)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: "wakes", from: "wake_id", to: "wake_id" }),
      ]));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_wakes_claim', 'idx_wakes_conversation') ORDER BY name").all()).toEqual([
        { name: "idx_wakes_claim" },
        { name: "idx_wakes_conversation" },
      ]);
      expect(() => db.prepare(
        `INSERT INTO wakes
           (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
            state, terminal_reason, captured_authority_revision, created_at_ms, updated_at_ms)
         VALUES ('wake:v12-superseded', 'occ:v12-superseded', 'trigger:v12-superseded', 'inbox',
            'conversation:v12-superseded', 'cycle:v12-superseded', 'terminal', 'superseded', 1, 30, 30)`,
      ).run()).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("migrates a v8 sidecar to the v9 policy-scoped consuming index without touching rows", () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    try {
      const wake = admitWake(db, {
        occurrenceId: "occurrence:v8-index",
        triggerRef: "trigger:v8-index",
        sourceKind: "idle",
        conversationId: "conversation:v8-index",
        cycleId: "cycle:v8-index",
        capturedAuthorityRevision: 1,
        nowMs: 1_000,
      });
      expect(reservePrivateThought(db, {
        admissionId: "admission:v8-index",
        wakeId: wake.wake.wakeId,
        conversationId: "conversation:v8-index",
        policyId: "private-v1",
        wallClockNowMs: 1_000,
      }).kind).toBe("reserved");
      // Rewind to the v8 shape: old per-conversation index + v8 versions.
      db.exec("DROP INDEX IF EXISTS idx_private_budget_consuming");
      db.exec("CREATE INDEX idx_private_budget_consuming ON private_budget_reservations(conversation_id, policy_id, policy_time_ms, state)");
      db.exec("DROP INDEX IF EXISTS idx_social_conv_lookup");
      db.exec("DROP INDEX IF EXISTS idx_observation_subscriptions_external_poll");
      db.exec("DROP TABLE social_conversations");
      db.exec(`
        ALTER TABLE observation_subscriptions DROP COLUMN expiry_opportunity_emitted_at_ms;
        ALTER TABLE observation_subscriptions DROP COLUMN last_poll_outcome;
        ALTER TABLE observation_subscriptions DROP COLUMN last_polled_at_ms;
        ALTER TABLE observation_subscriptions DROP COLUMN requester_id;
        ALTER TABLE observation_subscriptions DROP COLUMN expires_at_ms;
        ALTER TABLE observation_subscriptions DROP COLUMN poll_interval_ms;
        ALTER TABLE observation_subscriptions DROP COLUMN external_source_url_pattern;
        ALTER TABLE observation_subscriptions DROP COLUMN external_source_type;
        ALTER TABLE conversation_evidence_log DROP COLUMN provenance_json;
        ALTER TABLE conversation_evidence_log DROP COLUMN attachment_refs_json;
        ALTER TABLE conversation_evidence_log DROP COLUMN mention_ids_json;
        ALTER TABLE conversation_evidence_log DROP COLUMN reply_to_message_id;
        ALTER TABLE conversation_evidence_log DROP COLUMN sent_at_ms;
        ALTER TABLE conversation_evidence_log DROP COLUMN audience_at_capture;
        ALTER TABLE conversation_evidence_log DROP COLUMN location_json;
        ALTER TABLE conversation_evidence_log DROP COLUMN speaker_kind;
        ALTER TABLE conversation_evidence_log DROP COLUMN speaker_principal_id;
        ALTER TABLE inbox_events DROP COLUMN envelope_json;
        ALTER TABLE cycle_records DROP COLUMN disposition;
        ALTER TABLE cycle_records DROP COLUMN pending_queue_json;
        ALTER TABLE cycle_records DROP COLUMN supersessions_used;
        ALTER TABLE cycle_records DROP COLUMN attempt_input_basis_json;
        ALTER TABLE cycle_records DROP COLUMN attempt_id;
      `);
      db.exec("PRAGMA user_version = 8");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 8 WHERE id = 1").run();
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      const indexColumns = (
        db.prepare("PRAGMA index_info(idx_private_budget_consuming)").all() as Array<{ seqno: number; cid: number; name: string }>
      ).sort((a, b) => a.seqno - b.seqno).map((column) => column.name);
      expect(indexColumns).toEqual(["policy_id", "policy_time_ms", "state"]);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      // The pre-existing row still counts under the global scope.
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects a reserved production file when the caller has an isolated plane", () => {
    expect(() =>
      openCognitiveSidecarDb(
        fakeDatabaseWithMainFile(reservedProductionCognitiveSidecarDbPath()),
        { dataPlane: { kind: "isolated" } },
      ),
    ).toThrow(/production_data_plane_required/);
  });

  it("is idempotent and keeps one meta singleton with mutable epoch updates", () => {
    const db = new DatabaseSync(":memory:");
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM cognitive_sidecar_meta")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(() =>
      db
        .prepare(
          "INSERT INTO cognitive_sidecar_meta (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version) VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1)",
        )
        .run(),
    ).toThrow();

    db.prepare(
      "UPDATE cognitive_sidecar_meta SET authority_epoch = ? WHERE id = 1",
    ).run(7);
    expect(
      (
        db
          .prepare(
            "SELECT authority_epoch FROM cognitive_sidecar_meta WHERE id = 1",
          )
          .get() as { authority_epoch: number }
      ).authority_epoch,
    ).toBe(7);
    db.close();
  });

  it("upgrades a v1 sidecar into an explicitly reconciling projection state", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
       VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
    ).run();
    db.exec("PRAGMA user_version = 1");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(readCognitiveProjectionState(db)).toMatchObject({
        barrierRevision: 0,
        ownerVersions: { nuclear: 0, continuity: 0, cognitive_sidecar: 0 },
        state: "reconciling",
      });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("classifies legacy lineage once, binds recoverable rows, and quarantines ambiguity", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
       VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO cycle_records
         (cycle_id, conversation_id, generation, state, trigger_kind, trigger_ref,
          occupant_id, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms,
          compose_log_ids_json, preempted_generation)
       VALUES ('legacy-cycle', 'legacy-thread', 1, 'admitted', 'owner_message', 'legacy-ref',
          'doc', 1, 'v0.2.1', 1, 1, '[]', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status)
       VALUES ('legacy-bound-event', 'legacy-thread', 'owner_message', ?, 2, 'pending')`,
    ).run(JSON.stringify({ cycleId: "legacy-cycle", referenceOnly: true }));
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status)
       VALUES ('legacy-ambiguous-event', 'legacy-thread', 'owner_message', '{not-json', 3, 'pending')`,
    ).run();
    db.prepare(
      `INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
       VALUES ('legacy-settlement', 'legacy-cycle', 1, '{}')`,
    ).run();
    db.prepare(
      `INSERT INTO in_flight_effects
         (effect_id, cycle_id, generation, correlation_id, idempotency_key, state, payload_json, dispatched_at_ms, origin_job_id)
       VALUES ('legacy-effect', 'legacy-cycle', 1, 'legacy-correlation', 'legacy-idempotency', 'in_flight', '{}', 4, NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO future_triggers
         (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
       VALUES ('legacy-fired-trigger', 'legacy-fired-thread', 'legacy-concern', 5, 'legacy-snapshot', 'fired', '{}')`,
    ).run();
    db.exec("PRAGMA user_version = 1");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      const boundCycle = db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = 'legacy-cycle'").get() as { wake_id: string };
      expect(boundCycle.wake_id).toMatch(/^wake:/);
      expect(db.prepare("SELECT wake_id FROM inbox_events WHERE id = 'legacy-bound-event'").get()).toMatchObject({ wake_id: boundCycle.wake_id });
      expect(db.prepare("SELECT wake_id FROM settlements WHERE settlement_id = 'legacy-settlement'").get()).toMatchObject({ wake_id: boundCycle.wake_id });
      expect(db.prepare("SELECT wake_id, state FROM in_flight_effects WHERE effect_id = 'legacy-effect'").get()).toMatchObject({ wake_id: boundCycle.wake_id, state: "unknown" });

      expect(db.prepare("SELECT status, last_error FROM inbox_events WHERE id = 'legacy-ambiguous-event'").get()).toMatchObject({ status: "failed_terminal", last_error: "legacy_ambiguous" });
      expect(db.prepare("SELECT table_name, row_key, reason FROM wake_legacy_quarantine WHERE table_name = 'inbox_events' AND row_key = 'legacy-ambiguous-event'").get()).toMatchObject({
        table_name: "inbox_events",
        row_key: "legacy-ambiguous-event",
        reason: "legacy_ambiguous",
      });

      const firedWake = db.prepare(
        `SELECT f.wake_id, w.cycle_id
           FROM future_triggers f JOIN wakes w ON w.wake_id = f.wake_id
          WHERE f.trigger_id = 'legacy-fired-trigger'`,
      ).get() as { wake_id: string; cycle_id: string };
      expect(firedWake.wake_id).toMatch(/^wake:/);
      expect(db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?").get(firedWake.cycle_id)).toMatchObject({ wake_id: firedWake.wake_id });

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("SELECT COUNT(*) AS count FROM wake_legacy_quarantine").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("preserves v3 retry history and moves unverifiable claimed work to reconciliation", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
       VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO cycle_records
         (cycle_id, conversation_id, generation, state, trigger_kind, trigger_ref,
          occupant_id, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms,
          compose_log_ids_json, preempted_generation)
       VALUES ('legacy-retry-cycle', 'legacy-retry-thread', 1, 'admitted', 'owner_message',
          'legacy-retry', 'doc', 1, 'v0.2.1', 1, 1, '[]', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status, claim_token,
          worker_id, lease_expires_at_ms, attempt_count, claimed_at_ms)
       VALUES ('legacy-failed', 'legacy-retry-thread', 'owner_message', ?, 2, 'failed_retryable',
          NULL, NULL, NULL, 2, 50)`,
    ).run(JSON.stringify({ cycleId: "legacy-retry-cycle", referenceOnly: true }));
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status, claim_token,
          worker_id, lease_expires_at_ms, attempt_count, claimed_at_ms)
       VALUES ('legacy-claimed', 'legacy-retry-thread', 'owner_message', ?, 3, 'claimed',
          'legacy-claim', 'legacy-worker', 500, 1, 75)`,
    ).run(JSON.stringify({ cycleId: "legacy-retry-cycle", referenceOnly: true }));
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
    db.prepare(
      `INSERT INTO wakes
         (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
          state, terminal_reason, captured_authority_revision, created_at_ms, updated_at_ms)
       VALUES ('wake:legacy-retry', 'occurrence:legacy-retry', 'legacy-retry', 'inbox',
          'legacy-retry-thread', 'legacy-retry-cycle', 'pending', NULL, 0, 1, 1)`,
    ).run();
    db.prepare("UPDATE cycle_records SET wake_id = 'wake:legacy-retry' WHERE cycle_id = 'legacy-retry-cycle'").run();
    db.prepare("UPDATE inbox_events SET wake_id = 'wake:legacy-retry' WHERE conversation_id = 'legacy-retry-thread'").run();
    db.exec("PRAGMA user_version = 3");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT state, status, attempt_count, first_attempt_at_ms, last_failure_class, claim_token FROM inbox_events WHERE id = 'legacy-failed'").get()).toMatchObject({
        state: "reconciling",
        status: "claimed",
        attempt_count: 2,
        first_attempt_at_ms: 50,
        last_failure_class: "outcome_unknown_reconcile",
        claim_token: null,
      });
      expect(db.prepare("SELECT state, status, attempt_count, first_attempt_at_ms, last_failure_class, claim_token FROM inbox_events WHERE id = 'legacy-claimed'").get()).toMatchObject({
        state: "reconciling",
        status: "claimed",
        attempt_count: 1,
        first_attempt_at_ms: 75,
        last_failure_class: "outcome_unknown_reconcile",
        claim_token: null,
      });
    } finally {
      db.close();
    }
  });

  it("upgrades v4 without assuming zero private usage and bootstraps the first reservation on fresh history", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
       VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
    ).run();
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V4);
    db.exec("PRAGMA user_version = 4");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number }).schema_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_policy_clock").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(0);

      const wake = admitWake(db, {
        occurrenceId: "occurrence:w7-migration-epoch",
        triggerRef: "trigger:w7-migration-epoch",
        sourceKind: "idle",
        conversationId: "conversation:w7-migration",
        cycleId: "cycle:w7-migration",
        capturedAuthorityRevision: 1,
        nowMs: 7_000_000,
      });
      const first = reservePrivateThought(db, {
        admissionId: "admission:w7-migration-epoch",
        wakeId: wake.wake.wakeId,
        conversationId: "conversation:w7-migration",
        policyId: "ashley.private_thought.v1",
        wallClockNowMs: 7_000_000,
      });
      expect(first.kind).toBe("reserved");
      if (first.kind !== "reserved") throw new Error("test_reservation_missing");
      expect(first.remaining).toBe(3);
      expect(db.prepare("SELECT clock_state FROM private_budget_policy_clock WHERE policy_id = 'ashley.private_thought.v1'").get()).toMatchObject({ clock_state: "stable" });
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects newer sidecar content and rolls back a failed v2 upgrade", () => {
    const newer = new DatabaseSync(":memory:");
    try {
      newer.exec("PRAGMA user_version = 21");
      let failure: unknown;
      try {
        openCognitiveSidecarDb(newer, { dataPlane: { kind: "isolated" } });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "unsupported_cognitive_sidecar_schema" });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("unsupported_cognitive_sidecar_schema:21>20");
    } finally {
      newer.close();
    }

    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
       VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
    ).run();
    db.exec(`
      PRAGMA user_version = 1;
      CREATE TRIGGER fail_sidecar_projection_upgrade
      BEFORE UPDATE OF schema_version ON cognitive_sidecar_meta
      BEGIN SELECT RAISE(ABORT, 'test_sidecar_v2_rollback'); END;
    `);
    try {
      expect(() => openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } }))
        .toThrow("test_sidecar_v2_rollback");
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
      expect((db.prepare("PRAGMA table_info(cognitive_sidecar_meta)").all() as Array<{ name: string }>)
        .map((column) => column.name)).not.toContain("projection_barrier_revision");
    } finally {
      db.close();
    }
  });

  it("migrates from v5 to v6 adding event provenance columns and demoting historical receipts", () => {
    const db = new DatabaseSync(":memory:");
    // Set up up to V5
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);

    // Verify columns on in_flight_effects
    const columns = (db.prepare("PRAGMA table_info(in_flight_effects)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toContain("origin_event_id");
    expect(columns).toContain("origin_attempt_id");

    // Insert receipts with old values
    db.prepare("INSERT INTO effect_receipts (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms, data_classification, secret_omitted) VALUES ('r-succ', 'e-succ', 'i-succ', 'succeeded', '{}', 1, 'never_public', 0)").run();
    db.prepare("INSERT INTO effect_receipts (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms, data_classification, secret_omitted) VALUES ('r-fail', 'e-fail', 'i-fail', 'failed', '{}', 1, 'never_public', 0)").run();
    db.prepare("INSERT INTO effect_receipts (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms, data_classification, secret_omitted) VALUES ('r-unk', 'e-unk', 'i-unk', 'unknown', '{}', 1, 'never_public', 0)").run();

    // Re-run migration logic
    db.prepare("UPDATE effect_receipts SET outcome = 'outcome_unknown' WHERE outcome IN ('failed', 'unknown')").run();

    expect((db.prepare("SELECT outcome FROM effect_receipts WHERE receipt_id = 'r-succ'").get() as any).outcome).toBe("succeeded");
    expect((db.prepare("SELECT outcome FROM effect_receipts WHERE receipt_id = 'r-fail'").get() as any).outcome).toBe("outcome_unknown");
    expect((db.prepare("SELECT outcome FROM effect_receipts WHERE receipt_id = 'r-unk'").get() as any).outcome).toBe("outcome_unknown");
    db.close();
  });

  it("migrates a v9 sidecar to the v10 child attempt bindings table without touching rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
         (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
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
    db.prepare(
      `INSERT INTO wakes
         (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
          state, terminal_reason, captured_authority_revision, created_at_ms, updated_at_ms)
       VALUES ('wake:v9-test', 'occ:v9-test', 'trig:v9-test', 'idle',
          'conv:v9-test', 'cycle:v9-test', 'authorized', NULL, 1, 1000, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO private_budget_reservations
         (reservation_id, admission_id, wake_id, conversation_id, policy_id,
          policy_time_ms, state, dispatch_truth, release_proof_ref, created_at_ms, updated_at_ms)
       VALUES ('res:v9-test', 'adm:v9-test', 'wake:v9-test', 'conv:v9-test', 'policy:v9',
          1000, 'released', 'not_started', 'proof:v9-prior', 1000, 1000)`,
    ).run();
    db.exec("PRAGMA user_version = 9");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(
        db.prepare(
          "SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1",
        ).get(),
      ).toEqual({ schema_version: COGNITIVE_SIDECAR_SCHEMA_VERSION });

      // Existing reservation row untouched
      expect(
        db.prepare("SELECT reservation_id, state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = 'res:v9-test'").get(),
      ).toMatchObject({
        reservation_id: "res:v9-test",
        state: "released",
        dispatch_truth: "not_started",
        release_proof_ref: "proof:v9-prior",
      });

      // Child table exists and has 0 rows
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings").get(),
      ).toEqual({ count: 0 });

      const columns = (
        db.prepare("PRAGMA table_info(private_budget_attempt_bindings)").all() as Array<{ name: string }>
      ).map((c) => c.name);
      expect(columns).toEqual([
        "binding_id",
        "reservation_id",
        "invocation_id",
        "attempt_id",
        "ordinal",
        "reason",
        "dispatch_truth",
        "provider_request_id",
        "release_proof_ref",
        "created_at_ms",
        "updated_at_ms",
      ]);

      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'private_budget_attempt_bindings'").all() as Array<{ name: string }>
      ).map((i) => i.name);
      expect(indexes).toContain("idx_attempt_bindings_reservation");
    } finally {
      db.close();
    }
  });

  it("migrates a v10 sidecar to the v12 periodic and wake vocabulary tables without touching rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
    db.prepare(
      `INSERT INTO cognitive_sidecar_meta
        (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
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
    db.prepare(
      `INSERT INTO wakes
         (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
          state, terminal_reason, captured_authority_revision, created_at_ms, updated_at_ms)
       VALUES ('wake:v10-test', 'occ:v10-test', 'trig:v10-test', 'idle',
          'conv:v10-test', 'cycle:v10-test', 'authorized', NULL, 1, 1000, 1000)`,
    ).run();
    db.prepare(
      `INSERT INTO private_budget_reservations
         (reservation_id, admission_id, wake_id, conversation_id, policy_id,
          policy_time_ms, state, dispatch_truth, release_proof_ref, created_at_ms, updated_at_ms)
       VALUES ('res:v10-test', 'adm:v10-test', 'wake:v10-test', 'conv:v10-test', 'policy:v10',
          1000, 'released', 'not_started', 'proof:v10-prior', 1000, 1000)`,
    ).run();
    db.exec("PRAGMA user_version = 10");

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(
        db.prepare(
          "SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1",
        ).get(),
      ).toEqual({ schema_version: COGNITIVE_SIDECAR_SCHEMA_VERSION });

      // Pre-existing rows untouched; the migration seeds no schedule row.
      expect(
        db.prepare("SELECT state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = 'res:v10-test'").get(),
      ).toMatchObject({ state: "released", dispatch_truth: "not_started", release_proof_ref: "proof:v10-prior" });
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM periodic_cognition_schedule").get() as { count: number }).count,
      ).toBe(0);
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM periodic_cognition_occurrence_receipts").get() as { count: number }).count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});

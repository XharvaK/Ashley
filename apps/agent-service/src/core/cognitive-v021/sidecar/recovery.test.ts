import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { appendInboxEvent, claimInboxEvent } from "../cycle/inbox.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { openCognitiveSidecarDb } from "./db.js";
import { recoverCognitiveSidecar, reconsiderPendingSpeechOutbox } from "./recovery.js";
import { putInFlight } from "../effect/in-flight.js";
import { openNuclearDb } from "../../db.js";
import { OutboxDeliveryProjector } from "../delivery/outbox-projector.js";
import { insertOutboxPending } from "../speech/outbox.js";

describe("cognitive sidecar reopen recovery", () => {
  it("returns expired inbox claims and orphaned live projections to retryable states", () => {
    const db = openTestSidecar();
    appendInboxEvent(db, { conversationId: "thread-recovery", kind: "owner_message", payload: {}, createdAtMs: 1 });
    claimInboxEvent(db, { workerId: "crashed", nowMs: 10, leaseMs: 5 });
    db.prepare(
      `INSERT INTO speech_outbox
       (settlement_id, projection_key, cycle_id, generation, conversation_id, licensed_text,
        send_status, suppressed, origin, delivery_intent_json)
       VALUES ('settlement-recovery', 'speech:recovery', 'cycle-recovery', 1, 'thread-recovery',
        'hello', 'projecting', 0, 'live', '{}')`,
    ).run();
    const result = recoverCognitiveSidecar(db, 20);
    expect(result).toEqual({ inboxClaimsRecovered: 1, speechProjectionsRequeued: 1, noticeProjectionsRequeued: 0 });
    expect(db.prepare("SELECT status, state, last_error FROM inbox_events").get()).toMatchObject({ status: "pending", state: "pending", last_error: "recovered_before_dispatch" });
    expect(db.prepare("SELECT send_status FROM speech_outbox").get()).toMatchObject({ send_status: "pending" });
    db.close();
  });

  it("reopens orphaned effects as unknown and enqueues one idempotent recovery event", () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-v021-recovery-"));
    const databasePath = join(directory, "sidecar.db");
    let db = openCognitiveSidecarDb(new DatabaseSync(databasePath), {
      dataPlane: { kind: "isolated" },
    });
    admitTestCycle(db, {
      cycleId: "cycle-restart",
      conversationId: "conversation-restart",
      generation: 3,
      triggerKind: "owner_message",
      triggerRef: "event-restart",
      occupantId: "doc",
      nowMs: 1,
    });
    putInFlight(db, {
      effectId: "effect-restart",
      cycleId: "cycle-restart",
      generation: 3,
      correlationId: "correlation-restart",
      idempotencyKey: "idempotency-restart",
      payload: { projectId: "project-restart" },
      dispatchedAtMs: 1,
      originEventId: "event-restart",
    });
    db.close();

    try {
      db = openCognitiveSidecarDb(new DatabaseSync(databasePath), {
        dataPlane: { kind: "isolated" },
      });
      expect(db.prepare("SELECT state FROM in_flight_effects WHERE effect_id = 'effect-restart'").get()).toMatchObject({ state: "unknown" });
      expect(db.prepare("SELECT id, kind FROM inbox_events WHERE kind = 'recovery'").all()).toEqual([
        { id: "recovery:effect-restart", kind: "recovery" },
      ]);
      const payload = db.prepare("SELECT payload_json FROM inbox_events WHERE id = 'recovery:effect-restart'").get() as { payload_json: string };
      expect(JSON.parse(payload.payload_json)).toMatchObject({
        cycleId: "cycle-restart",
        generation: 3,
        effectId: "effect-restart",
        correlationId: "correlation-restart",
      });
      db.close();
      db = openCognitiveSidecarDb(new DatabaseSync(databasePath), {
        dataPlane: { kind: "isolated" },
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = 'recovery:effect-restart'").get()).toMatchObject({ count: 1 });
    } finally {
      try { db.close(); } catch { /* already closed */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("SW-2 reconsiders a committed pending speech row after restart exactly once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-v021-speech-recovery-"));
    const databasePath = join(directory, "sidecar.db");
    let sidecar = openCognitiveSidecarDb(new DatabaseSync(databasePath), {
      dataPlane: { kind: "isolated" },
    });
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));

    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-speech-restart",
        conversationId: "conversation-speech-restart",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-speech-restart",
        occupantId: "doc",
        nowMs: 1,
      });

      // Model the publication commit that durably wrote the settlement and
      // speech outbox before the process crashed before projectOutbox.
      sidecar.exec("BEGIN IMMEDIATE");
      sidecar.prepare(
        `INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
         VALUES ('settlement-speech-restart', 'cycle-speech-restart', 1, '{}')`,
      ).run();
      const committed = insertOutboxPending(sidecar, {
        settlementId: "settlement-speech-restart",
        cycleId: "cycle-speech-restart",
        generation: 1,
        conversationId: "conversation-speech-restart",
        licensedText: "committed before the crash",
      });
      sidecar.exec("COMMIT");
      sidecar.close();

      // Reopen the sidecar as a new process would. The pending row must remain
      // the same durable speech, not trigger a new Thought run.
      sidecar = openCognitiveSidecarDb(new DatabaseSync(databasePath), {
        dataPlane: { kind: "isolated" },
      });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      const first = await reconsiderPendingSpeechOutbox(
        sidecar,
        (outboxId) => projector.project(outboxId),
      );
      const second = await reconsiderPendingSpeechOutbox(
        sidecar,
        (outboxId) => projector.project(outboxId),
      );

      expect(first).toEqual({ reconsidered: 1, failures: 0 });
      expect(second).toEqual({ reconsidered: 0, failures: 0 });
      expect(sidecar.prepare(
        "SELECT send_status, licensed_text, nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(committed.outboxId)).toMatchObject({
        send_status: "projected",
        licensed_text: "committed before the crash",
        nuclear_reservation_id: 1,
      });
      expect(nuclear.prepare(
        "SELECT COUNT(*) AS count, MIN(cognitive_v021_projection_key) AS projection_key FROM delivery_reservations",
      ).get()).toMatchObject({ count: 1, projection_key: `speech:${committed.outboxId}` });
    } finally {
      try { sidecar.close(); } catch { /* already closed */ }
      nuclear.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("SW-2 delegates gate decisions and excludes shadow or suppressed rows", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const reactive = insertOutboxPending(sidecar, {
        settlementId: "settlement-recovery-reactive",
        cycleId: "cycle-recovery-reactive",
        generation: 1,
        conversationId: "conversation-recovery-reactive",
        licensedText: "reactive recovery",
      });
      const proactive = insertOutboxPending(sidecar, {
        settlementId: "settlement-recovery-proactive",
        cycleId: "cycle-recovery-proactive",
        generation: 1,
        conversationId: "conversation-recovery-proactive",
        licensedText: "proactive recovery",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "conversation-recovery-proactive",
          conversationId: "conversation-recovery-proactive",
          trigger: "idle",
          deliveryLane: "proactive",
          purpose: "licensed_speech",
        },
      });
      const shadow = insertOutboxPending(sidecar, {
        settlementId: "settlement-recovery-shadow",
        cycleId: "cycle-recovery-shadow",
        generation: 1,
        conversationId: "conversation-recovery-shadow",
        licensedText: "shadow recovery",
        origin: "shadow",
      });
      const suppressed = insertOutboxPending(sidecar, {
        settlementId: "settlement-recovery-suppressed",
        cycleId: "cycle-recovery-suppressed",
        generation: 1,
        conversationId: "conversation-recovery-suppressed",
        licensedText: "suppressed recovery",
      });
      sidecar.prepare(
        "UPDATE speech_outbox SET send_status = 'pending', suppressed = 1 WHERE outbox_id = ?",
      ).run(suppressed.outboxId);

      const projector = new OutboxDeliveryProjector(sidecar, nuclear, {
        gate: (intent) => intent.deliveryLane === "proactive"
          ? { ok: false, reason: "daily_cap" }
          : { ok: true },
      });
      const result = await reconsiderPendingSpeechOutbox(
        sidecar,
        (outboxId) => projector.project(outboxId),
      );

      expect(result).toEqual({ reconsidered: 2, failures: 0 });
      expect(sidecar.prepare(
        "SELECT outbox_id, send_status, suppressed FROM speech_outbox ORDER BY outbox_id",
      ).all()).toEqual([
        { outbox_id: reactive.outboxId, send_status: "projected", suppressed: 0 },
        { outbox_id: proactive.outboxId, send_status: "pending", suppressed: 0 },
        { outbox_id: shadow.outboxId, send_status: "suppressed_shadow", suppressed: 1 },
        { outbox_id: suppressed.outboxId, send_status: "pending", suppressed: 1 },
      ]);
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get())
        .toMatchObject({ count: 1 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("SW-2 leaves a pending row retryable when the projector fails", async () => {
    const sidecar = openTestSidecar();
    try {
      const row = insertOutboxPending(sidecar, {
        settlementId: "settlement-recovery-failure",
        cycleId: "cycle-recovery-failure",
        generation: 1,
        conversationId: "conversation-recovery-failure",
        licensedText: "retry me",
      });
      const result = await reconsiderPendingSpeechOutbox(sidecar, async () => {
        throw new Error("temporary_projection_failure");
      });
      expect(result).toEqual({ reconsidered: 1, failures: 1 });
      expect(sidecar.prepare(
        "SELECT send_status, nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(row.outboxId)).toMatchObject({ send_status: "pending", nuclear_reservation_id: null });
    } finally {
      sidecar.close();
    }
  });
});

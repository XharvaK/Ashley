import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../../db.js";
import { openTestSidecar } from "../../test-support.js";
import { insertOutboxPending } from "../../speech/outbox.js";
import { repairMissingC3Experiences } from "../c3-recovery.js";

function seedSidecarSources(sidecar: DatabaseSync): void {
  sidecar.prepare(
    `INSERT INTO cycle_records
       (cycle_id, conversation_id, generation, wake_id, state, trigger_kind,
        trigger_ref, occupant_id, authority_epoch, architecture_epoch,
        admitted_at_ms, updated_at_ms, compose_log_ids_json, preempted_generation)
     VALUES ('cycle:thought', 'conversation:thought', 1, NULL, 'silent',
       'owner_message', 'trigger:thought', 'doc', 1, 'v0.2.1', 1, 100, '[]', NULL)`,
  ).run();
  sidecar.prepare(
    `INSERT INTO system_notice_outbox
       (notice_key, projection_key, cycle_id, conversation_id, notice_text,
        send_status, origin, delivery_intent_json)
     VALUES ('thought_failure:conversation:thought:cycle:thought:1:unavailable',
       'system:thought', 'cycle:thought', 'conversation:thought',
       '[system] visible notice text', 'pending', 'live', '{}')`,
  ).run();
  sidecar.prepare(
    `INSERT INTO deferred_reactive_frontiers
       (frontier_id, conversation_id, cycle_id, generation, state,
        next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
        attempt_count, created_at_ms, updated_at_ms, terminal_reason)
     VALUES ('frontier:capacity', 'conversation:frontier', 'cycle:frontier', 1,
       'exhausted', 1, 2, 'evidence:frontier', 1, 1, 200,
       'capacity_wait_max_duration_exceeded')`,
  ).run();
  sidecar.prepare(
    `INSERT INTO cycle_records
       (cycle_id, conversation_id, generation, wake_id, state, trigger_kind,
        trigger_ref, occupant_id, authority_epoch, architecture_epoch,
        admitted_at_ms, updated_at_ms, compose_log_ids_json, preempted_generation)
     VALUES ('cycle:frontier', 'conversation:frontier', 1, NULL, 'silent',
       'owner_message', 'trigger:frontier', 'doc', 1, 'v0.2.1', 1, 100, '[]', NULL)`,
  ).run();
}

function insertDeliveryReservation(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  key: string,
  createdAt: string,
  finalizedAt: string,
  state: "aborted" | "expired" | "partially_delivered" = "aborted",
): number {
  const outbox = insertOutboxPending(sidecar, {
    settlementId: `settlement:delivery:${key}`,
    cycleId: `cycle:delivery:${key}`,
    generation: 1,
    conversationId: `conversation:delivery:${key}`,
    licensedText: `licensed text ${key}`,
  });
  const result = nuclear.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, trigger, delivery_lane, state,
        error_category, finalization_reason, draft_text, created_at,
        finalized_at, cognitive_v021_projection_key)
     VALUES ('doc', 'discord', ?, 'reactive', 'reactive', ?, 'send_failure',
       'send_failure', ?, ?, ?, ?)`,
  ).run(
    `conversation:delivery:${key}`,
    state,
    `licensed text ${key}`,
    createdAt,
    finalizedAt,
    `speech:${outbox.outboxId}`,
  );
  return Number(result.lastInsertRowid);
}

describe("C3 bounded forward recovery", () => {
  it("recovers post-cutover thought/frontier/delivery terminal rows and is write-once", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The first valid startup binds the delivery watermark to reservations
      // that already exist. Establish it before creating post-cutover work.
      expect((await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 200 })).recorded).toBe(0);
      seedSidecarSources(sidecar);
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement:delivery",
        cycleId: "cycle:delivery",
        generation: 1,
        conversationId: "conversation:delivery",
        licensedText: "licensed text",
      });
      nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            error_category, finalization_reason, draft_text, created_at,
            finalized_at, cognitive_v021_projection_key)
         VALUES ('doc', 'discord', 'conversation:delivery', 'reactive',
           'reactive', 'aborted', 'send_failure', 'send_failure',
           'licensed text', '2026-09-04T00:00:00.000Z',
           '2026-09-04T00:00:01.000Z', ?)`,
      ).run(`speech:${outbox.outboxId}`);

      const first = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 300, limit: 50 });
      expect(first.recorded).toBe(3);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 3 });
      expect(sidecar.prepare("SELECT experience_id FROM c3_terminal_experiences ORDER BY experience_id").all()).toEqual([
        { experience_id: "c3:delivery:1:delivery_aborted" },
        { experience_id: "c3:frontier:frontier:capacity:capacity_wait_max_duration_exceeded" },
        { experience_id: "c3:thought:thought_failure:conversation:thought:cycle:thought:1:unavailable" },
      ]);
      const second = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 301, limit: 50 });
      expect(second.recorded).toBe(0);
      expect(second.scanned).toBe(0);
      expect(second.skipped).toBe(0);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 3 });
      expect(sidecar.prepare("SELECT max_pre_v8_delivery_reservation_id FROM c3_activation_cutover WHERE id = 1").get()).toEqual({ max_pre_v8_delivery_reservation_id: 0 });

      const later = insertOutboxPending(sidecar, {
        settlementId: "settlement:delivery:later",
        cycleId: "cycle:delivery:later",
        generation: 1,
        conversationId: "conversation:delivery:later",
        licensedText: "later licensed text",
      });
      nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            error_category, finalization_reason, draft_text, created_at,
            finalized_at, cognitive_v021_projection_key)
         VALUES ('doc', 'discord', 'conversation:delivery:later', 'reactive',
           'reactive', 'expired', 'send_failure', 'delivery_lease_expired',
           'later licensed text', '2026-09-04T00:00:02.000Z',
           '2026-09-04T00:00:03.000Z', ?)` ,
      ).run(`speech:${later.outboxId}`);
      expect((await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 302 })).recorded).toBe(1);
      expect(sidecar.prepare("SELECT max_pre_v8_delivery_reservation_id FROM c3_activation_cutover WHERE id = 1").get()).toEqual({ max_pre_v8_delivery_reservation_id: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("does not backfill pre-cutover sources and does not mint publication or unknown failures", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      sidecar.prepare(
        `INSERT INTO cycle_records
           (cycle_id, conversation_id, generation, wake_id, state, trigger_kind,
            trigger_ref, occupant_id, authority_epoch, architecture_epoch,
            admitted_at_ms, updated_at_ms, compose_log_ids_json, preempted_generation)
         VALUES ('cycle:pre', 'conversation:pre', 1, NULL, 'silent',
           'owner_message', 'trigger:pre', 'doc', 1, 'v0.2.1', 1, 100, '[]', NULL)`,
      ).run();
      sidecar.prepare(
        `INSERT INTO system_notice_outbox
           (notice_key, projection_key, cycle_id, conversation_id, notice_text,
            send_status, origin, delivery_intent_json)
         VALUES ('thought_failure:conversation:pre:cycle:pre:1:unavailable',
           'system:pre', 'cycle:pre', 'conversation:pre', 'old', 'pending', 'live', '{}')`,
      ).run();
      nuclear.exec("INSERT INTO delivery_reservations (owner_id, channel, thread_id, trigger, delivery_lane, state, created_at, cognitive_v021_projection_key) VALUES ('doc', 'discord', 'pre', 'reactive', 'reactive', 'aborted', '2026-09-04T00:00:00.000Z', 'speech:999')");
      sidecar.prepare("UPDATE c3_activation_cutover SET max_pre_v8_notice_id = (SELECT MAX(notice_id) FROM system_notice_outbox) WHERE id = 1").run();
      const result = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 500 });
      expect(result.recorded).toBe(0);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("excludes shadow-only notices while recovering one live terminal notice idempotently", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect((await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 100 })).recorded).toBe(0);
      const cycleInsert = sidecar.prepare(
        `INSERT INTO cycle_records
           (cycle_id, conversation_id, generation, wake_id, state, trigger_kind,
            trigger_ref, occupant_id, authority_epoch, architecture_epoch,
            admitted_at_ms, updated_at_ms, compose_log_ids_json, preempted_generation)
         VALUES (?, ?, 1, NULL, 'silent', 'owner_message', ?, 'doc', 1,
           'v0.2.1', 1, 100, '[]', NULL)`,
      );
      const noticeInsert = sidecar.prepare(
        `INSERT INTO system_notice_outbox
           (notice_key, projection_key, cycle_id, conversation_id, notice_text,
            send_status, origin, delivery_intent_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
      );
      for (const kind of ["shadow", "live"] as const) {
        const cycleId = `cycle:notice:${kind}`;
        const conversationId = `conversation:notice:${kind}`;
        cycleInsert.run(cycleId, conversationId, `trigger:${kind}`);
        noticeInsert.run(
          `thought_failure:${conversationId}:${cycleId}:1:unavailable`,
          `system:${kind}`,
          cycleId,
          conversationId,
          `[system] ${kind} notice`,
          kind === "shadow" ? "suppressed_shadow" : "pending",
          kind,
        );
      }

      const first = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 200 });
      expect(first.recorded).toBe(1);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 1 });
      expect(sidecar.prepare("SELECT experience_id FROM c3_terminal_experiences").all()).toEqual([
        { experience_id: "c3:thought:thought_failure:conversation:notice:live:cycle:notice:live:1:unavailable" },
      ]);
      const second = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 201 });
      expect(second.recorded).toBe(0);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 1 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("repairs post-cutover terminalization for a pre-cutover reservation without historical backfill", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      sidecar.prepare("UPDATE c3_activation_cutover SET activated_at_ms = 1000 WHERE id = 1").run();
      const historicalId = insertDeliveryReservation(
        sidecar,
        nuclear,
        "historical",
        "1970-01-01T00:00:00.500Z",
        "1970-01-01T00:00:00.900Z",
      );
      const forwardId = insertDeliveryReservation(
        sidecar,
        nuclear,
        "forward",
        "1970-01-01T00:00:00.500Z",
        "1970-01-01T00:00:01.100Z",
      );
      expect(historicalId).toBe(1);
      expect(forwardId).toBe(2);

      const first = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 2_000 });
      expect(first.recorded).toBe(1);
      expect(sidecar.prepare("SELECT experience_id FROM c3_terminal_experiences").all()).toEqual([
        { experience_id: "c3:delivery:2:delivery_aborted" },
      ]);

      const postCutoverId = insertDeliveryReservation(
        sidecar,
        nuclear,
        "post-cutover",
        "1970-01-01T00:00:01.200Z",
        "1970-01-01T00:00:01.300Z",
        "expired",
      );
      expect(postCutoverId).toBe(3);
      const second = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 2_001 });
      expect(second.recorded).toBe(1);
      expect((await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 2_002 })).recorded).toBe(0);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 2 });
      expect(sidecar.prepare("SELECT max_pre_v8_delivery_reservation_id FROM c3_activation_cutover WHERE id = 1").get()).toEqual({
        max_pre_v8_delivery_reservation_id: 2,
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("drains more than 50 oldest candidates across repeated recovery passes", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect((await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 1 })).recorded).toBe(0);
      const cycleInsert = sidecar.prepare(
        `INSERT INTO cycle_records
           (cycle_id, conversation_id, generation, wake_id, state, trigger_kind,
            trigger_ref, occupant_id, authority_epoch, architecture_epoch,
            admitted_at_ms, updated_at_ms, compose_log_ids_json, preempted_generation)
         VALUES (?, ?, 1, NULL, 'silent', 'owner_message', ?, 'doc', 1,
           'v0.2.1', ?, ?, '[]', NULL)`,
      );
      const noticeInsert = sidecar.prepare(
        `INSERT INTO system_notice_outbox
           (notice_key, projection_key, cycle_id, conversation_id, notice_text,
            send_status, origin, delivery_intent_json)
         VALUES (?, ?, ?, ?, '[system] bounded recovery notice', 'pending', 'live', '{}')`,
      );
      for (let index = 0; index < 51; index += 1) {
        const cycleId = `cycle:batch:${index}`;
        const conversationId = `conversation:batch:${index}`;
        cycleInsert.run(
          cycleId,
          conversationId,
          `trigger:batch:${index}`,
          10 + index,
          10 + index,
        );
        noticeInsert.run(
          `thought_failure:${conversationId}:${cycleId}:1:unavailable`,
          `system:batch:${index}`,
          cycleId,
          conversationId,
        );
      }

      const first = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 100, limit: 50 });
      expect(first.recorded).toBe(50);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 50 });

      const second = await repairMissingC3Experiences(sidecar, nuclear, { nowMs: 101, limit: 50 });
      expect(second.recorded).toBe(1);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 51 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

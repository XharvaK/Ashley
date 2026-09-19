import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { insertOutboxPending, suppressUndeliveredOutbox } from "../speech/outbox.js";
import { emitInfrastructureNotice } from "../speech/infrastructure-notice.js";
import { OutboxDeliveryProjector } from "./outbox-projector.js";
import {
  claimPendingCognitiveDeliveries,
  claimPendingSystemNotifications,
  listPendingCognitiveDeliveries,
} from "./pending.js";

describe("v0.2.1 projected delivery claim", () => {
  it("claims only projected Discord reservations and leases one at a time", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-pending",
        cycleId: "cycle-pending",
        generation: 1,
        conversationId: "thread-pending",
        licensedText: "hello from the cognitive outbox",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-pending",
          conversationId: "thread-pending",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 })
        .project(outbox.outboxId);

      expect(listPendingCognitiveDeliveries(nuclear, "doc")).toHaveLength(1);
      const claimed = claimPendingCognitiveDeliveries(nuclear, {
        ownerId: "doc",
        nowMs: 2_000,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.draftText).toBe("hello from the cognitive outbox");
      expect(claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 3_000 }))
        .toEqual([]);
      expect(nuclear.prepare(
        "SELECT state FROM delivery_reservations WHERE id = ?",
      ).get(claimed[0]!.reservationId)).toMatchObject({ state: "sending" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("does not claim an unprojected legacy reservation", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at)
         VALUES ('doc', 'discord', 'thread-legacy', 'reactive', 'reactive',
                 'reserved', 'legacy', '1970-01-01T00:00:01.000Z')`,
      ).run();
      expect(listPendingCognitiveDeliveries(nuclear, "doc")).toEqual([]);
      expect(claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc" }))
        .toEqual([]);
    } finally {
      nuclear.close();
    }
  });

  it.each(["suppressed", "suppressed_shadow"] as const)(
    "refuses a %s sidecar outbox even while its nuclear reservation is reserved",
    async (status) => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${status}`,
          cycleId: `cycle-${status}`,
          generation: 1,
          conversationId: `thread-${status}`,
          licensedText: `suppressed ${status}`,
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: `thread-${status}`,
            conversationId: `thread-${status}`,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });
        await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 })
          .project(outbox.outboxId);
        sidecar.prepare(
          "UPDATE speech_outbox SET send_status = ?, suppressed = 1 WHERE outbox_id = ?",
        ).run(status, outbox.outboxId);

        expect(listPendingCognitiveDeliveries(nuclear, "doc")).toEqual([]);
        expect(claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc" })).toEqual([]);
        expect(nuclear.prepare("SELECT state FROM delivery_reservations").get()).toEqual({ state: "reserved" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    },
  );

  it("expires an expired zero-receipt sending reservation ambiguously without replay", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-ambiguous-send",
        cycleId: "cycle-ambiguous-send",
        generation: 1,
        conversationId: "thread-ambiguous-send",
        licensedText: "possibly sent",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-ambiguous-send",
          conversationId: "thread-ambiguous-send",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 })
        .project(outbox.outboxId);
      const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 2_000 });
      expect(claimed).toHaveLength(1);

      // No sending row may remain ownerless: the lease-expired stranded row
      // fails closed (expired, never replayed) with a visible notice, since
      // zero receipts cannot prove zero dispatch.
      expect(claimPendingCognitiveDeliveries(nuclear, {
        ownerId: "doc",
        nowMs: 200_000,
      })).toEqual([]);
      expect(nuclear.prepare(
        "SELECT state, first_sent_at, finalization_reason FROM delivery_reservations WHERE id = ?",
      ).get(claimed[0]!.reservationId)).toEqual({
        state: "expired",
        first_sent_at: null,
        finalization_reason: "delivery_lease_expired",
      });
      const notices = sidecar.prepare(
        "SELECT notice_text FROM system_notice_outbox WHERE notice_key LIKE 'delivery_exhausted:%'",
      ).all() as Array<{ notice_text?: unknown }>;
      expect(notices).toHaveLength(1);
      expect(String(notices[0]!.notice_text)).toContain("DELIVERY_UNCONFIRMED");
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("claims the oldest eligible speech reservation past an older system reservation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const system = emitInfrastructureNotice(sidecar, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-starvation",
        conversationId: "thread-starvation",
        reason: "thought_deadline",
      });
      const speech = insertOutboxPending(sidecar, {
        settlementId: "settlement-after-system",
        cycleId: "cycle-after-system",
        generation: 1,
        conversationId: "thread-starvation",
        licensedText: "current speech",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-starvation",
          conversationId: "thread-starvation",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.projectSystem(system.noticeId);
      await projector.project(speech.outboxId);

      expect(listPendingCognitiveDeliveries(nuclear, "doc").map((item) => item.draftText))
        .toEqual(["current speech"]);
      const claimed = claimPendingCognitiveDeliveries(nuclear, {
        ownerId: "doc",
        nowMs: 2_000,
      });

      expect(claimed.map((item) => item.draftText)).toEqual(["current speech"]);
      expect(nuclear.prepare(
        "SELECT state FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(system.projectionKey)).toEqual({ state: "reserved" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("keeps system notices independent across stale speech preemption and current speech selection", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const system = emitInfrastructureNotice(sidecar, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-cross-composition",
        conversationId: "thread-cross-composition",
        reason: "thought_deadline",
      });
      const staleSpeech = insertOutboxPending(sidecar, {
        settlementId: "settlement-stale-speech",
        cycleId: "cycle-stale-speech",
        generation: 1,
        conversationId: "thread-cross-composition",
        licensedText: "stale speech",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-cross-composition",
          conversationId: "thread-cross-composition",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      const currentSpeech = insertOutboxPending(sidecar, {
        settlementId: "settlement-current-speech",
        cycleId: "cycle-current-speech",
        generation: 2,
        conversationId: "thread-cross-composition",
        licensedText: "current speech",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-cross-composition",
          conversationId: "thread-cross-composition",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.projectSystem(system.noticeId);
      await projector.project(staleSpeech.outboxId);
      await projector.project(currentSpeech.outboxId);

      expect(suppressUndeliveredOutbox(sidecar, { outboxId: staleSpeech.outboxId })).toBe(1);
      const systemClaim = claimPendingSystemNotifications(nuclear, {
        ownerId: "doc",
        nowMs: 2_000,
      });
      const speechClaim = claimPendingCognitiveDeliveries(nuclear, {
        ownerId: "doc",
        nowMs: 2_000,
      });

      expect(systemClaim.map((item) => item.draftText)).toEqual([
        system.noticeText,
      ]);
      expect(speechClaim.map((item) => item.draftText)).toEqual(["current speech"]);
      expect(nuclear.prepare(
        "SELECT cognitive_v021_projection_key, state FROM delivery_reservations ORDER BY id",
      ).all()).toEqual([
        { cognitive_v021_projection_key: system.projectionKey, state: "sending" },
        { cognitive_v021_projection_key: `speech:${staleSpeech.outboxId}`, state: "cancelled" },
        { cognitive_v021_projection_key: `speech:${currentSpeech.outboxId}`, state: "sending" },
      ]);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("gives reactive system reservations a typed owner without collapsing them into speech", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const system = emitInfrastructureNotice(sidecar, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-system-owner",
        conversationId: "thread-system-owner",
        reason: "unavailable",
      });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.projectSystem(system.noticeId);

      const pendingModule = await import("./pending.js") as unknown as {
        claimPendingSystemNotifications?: typeof claimPendingCognitiveDeliveries;
      };
      expect(typeof pendingModule.claimPendingSystemNotifications).toBe("function");
      if (!pendingModule.claimPendingSystemNotifications) throw new Error("system_claim_owner_missing");

      const claimed = pendingModule.claimPendingSystemNotifications(nuclear, {
        ownerId: "doc",
        nowMs: 2_000,
      });

      expect(claimed.map((item) => item.draftText)).toEqual([
        "[system] Thought did not complete. Please send the message again. Error code: UNKNOWN",
      ]);
      expect(nuclear.prepare(
        "SELECT cognitive_v021_projection_key, state FROM delivery_reservations",
      ).all()).toEqual([{
        cognitive_v021_projection_key: system.projectionKey,
        state: "sending",
      }]);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

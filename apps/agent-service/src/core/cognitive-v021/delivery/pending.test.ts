import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { OutboxDeliveryProjector } from "./outbox-projector.js";
import {
  claimPendingCognitiveDeliveries,
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
});

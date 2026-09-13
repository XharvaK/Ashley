import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import "../../qualification/mistral-client-mock.js";
import { openNuclearDb } from "../../db.js";
import { claimReactiveDelivery, attachDraftAndBubbles, recordBubbleReceipt } from "../store.js";
import { finalizeDelivery } from "../finalize.js";

function prepareReceiptedDelivery() {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  const claim = claimReactiveDelivery(db, {
    ownerId: "doc",
    channel: "discord",
    mergedUserText: "finalize gating",
    inboundDiscordMessageIds: [`mat2-${Date.now()}-${Math.random()}`],
    finalFragmentReceivedAtMs: Date.now(),
    simulateDelivery: true,
  });
  expect(claim.kind).toBe("claimed");
  if (claim.kind !== "claimed") throw new Error("delivery_claim_missing");
  attachDraftAndBubbles(db, claim.reservation.id, "reply", [
    { ordinal: 0, text: "reply" },
  ]);
  recordBubbleReceipt(db, claim.reservation.id, 0, "discord-receipt");
  return { db, reservationId: claim.reservation.id };
}

describe("v021 delivery finalization", () => {
  it("does not enqueue a legacy cognitive job", () => {
    const { db, reservationId } = prepareReceiptedDelivery();
    try {
      const result = finalizeDelivery(db, {
        reservationId,
        ownerId: "doc",
        cause: "complete",
      });

      expect(result.state).toBe("committed");
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM cognitive_jobs").get(),
      ).toEqual({ count: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM mem_messages WHERE role = 'assistant'").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

});

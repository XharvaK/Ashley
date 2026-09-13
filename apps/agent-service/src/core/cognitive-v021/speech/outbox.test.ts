import { describe, expect, it } from "vitest";
import { insertOutboxPending, getSpeechOutbox, suppressUndeliveredOutbox } from "./outbox.js";
import { openTestSidecar } from "../test-support.js";

const intent = {
  ownerId: "doc", channel: "discord", threadId: "thread-1", conversationId: "thread-1" as const,
  trigger: "owner_message_reactive" as const, deliveryLane: "reactive" as const, purpose: "licensed_speech" as const,
};

describe("v0.2.1 speech outbox", () => {
  it("inserts one pending licensed row and suppresses only undelivered rows", () => {
    const db = openTestSidecar();
    try {
      const row = insertOutboxPending(db, {
        settlementId: "settlement-1", cycleId: "cycle-1", generation: 1,
        conversationId: "thread-1", licensedText: "hello", origin: "live", deliveryIntent: intent,
      });
      expect(row.projectionKey).toBe(`speech:${row.outboxId}`);
      expect(row.sendStatus).toBe("pending");
      expect(getSpeechOutbox(db, row.outboxId)).toMatchObject({ licensedText: "hello", suppressed: false });
      db.prepare("UPDATE speech_outbox SET send_status = 'delivered' WHERE outbox_id = ?").run(row.outboxId);
      expect(suppressUndeliveredOutbox(db, { conversationId: "thread-1", generation: 1 })).toBe(0);
    } finally {
      db.close();
    }
  });

  it("uses suppressed_shadow for shadow-origin rows", () => {
    const db = openTestSidecar();
    try {
      const row = insertOutboxPending(db, {
        settlementId: "settlement-shadow", cycleId: "cycle-1", generation: 1,
        conversationId: "thread-1", licensedText: "shadow", origin: "shadow", deliveryIntent: intent,
      });
      expect(row.sendStatus).toBe("suppressed_shadow");
      expect(row.suppressed).toBe(true);
    } finally {
      db.close();
    }
  });
});

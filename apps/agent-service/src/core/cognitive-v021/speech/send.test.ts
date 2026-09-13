import { describe, expect, it, vi } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { insertOutboxPending } from "./outbox.js";
import { sendOutbox } from "./send.js";

describe("v0.2.1 outbox send", () => {
  it("does not send a second time after a Discord receipt exists", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-send", conversationId: "thread-send", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const row = insertOutboxPending(db, { settlementId: "settlement-send", cycleId: "cycle-send", generation: 1, conversationId: "thread-send", licensedText: "hello" });
      db.prepare("UPDATE speech_outbox SET nuclear_reservation_id = 7, send_status = 'projected' WHERE outbox_id = ?").run(row.outboxId);
      let sends = 0;
      const transport = async () => { sends += 1; return ["discord-1"]; };
      await sendOutbox(db, row.outboxId, transport);
      await sendOutbox(db, row.outboxId, transport);
      expect(sends).toBe(1);
      expect(db.prepare("SELECT send_status, discord_message_ids_json FROM speech_outbox WHERE outbox_id = ?").get(row.outboxId)).toMatchObject({ send_status: "delivered", discord_message_ids_json: '["discord-1"]' });
    } finally {
      db.close();
    }
  });

  it("rejects a suppressed row even when a Nuclear reservation is present", async () => {
    const db = openTestSidecar();
    try {
      const row = insertOutboxPending(db, {
        settlementId: "settlement-suppressed", cycleId: "cycle-suppressed", generation: 1,
        conversationId: "thread-suppressed", licensedText: "must not send",
      });
      db.prepare("UPDATE speech_outbox SET nuclear_reservation_id = 42, send_status = 'suppressed', suppressed = 1 WHERE outbox_id = ?").run(row.outboxId);
      const transport = vi.fn(async () => ["should-not-send"]);
      await expect(sendOutbox(db, row.outboxId, transport)).rejects.toThrow("speech_outbox_suppressed");
      expect(transport).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});

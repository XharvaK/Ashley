import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { updateCycleState } from "./inbox.js";
import { composeOrPreempt } from "./fence.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";

describe("v0.2.1 cycle fence", () => {
  it("keeps an owner append composable while the cycle is thinking", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "first",
        occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      updateCycleState(db, cycle.cycleId, "thinking", 2);
      const evidence = appendOwnerUtterance(db, {
        conversationId: "thread-1", text: "new owner turn", discordMessageIds: ["d2"], nowMs: 3,
      });
      const result = composeOrPreempt(db, {
        conversationId: "thread-1", evidenceRowIds: [evidence.rowId], triggerRef: evidence.rowId,
        occupantId: "doc", authorityEpoch: 1, nowMs: 4,
      });
      expect(result.action).toBe("compose");
      expect(result.generation).toBe(1);
    } finally {
      db.close();
    }
  });

  it("preempts an unsent outbox and treats every in-flight effect as effectful", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "first",
        occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      updateCycleState(db, cycle.cycleId, "thinking", 2);
      insertOutboxPending(db, {
        settlementId: "settlement-1", cycleId: cycle.cycleId, generation: 1,
        conversationId: "thread-1", licensedText: "hello", origin: "live",
        deliveryIntent: { ownerId: "doc", channel: "discord", threadId: "thread-1", conversationId: "thread-1", trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech" },
      });
      db.prepare(`INSERT INTO in_flight_effects
        (effect_id, cycle_id, generation, correlation_id, idempotency_key, state, payload_json, dispatched_at_ms, origin_job_id)
        VALUES ('effect-1', ?, 1, 'corr', 'idem', 'in_flight', '{}', 2, NULL)`).run(cycle.cycleId);
      const result = composeOrPreempt(db, {
        conversationId: "thread-1", triggerRef: "owner-2", occupantId: "doc", authorityEpoch: 1, nowMs: 3,
      });
      expect(result.action).toBe("preempt");
      expect(result.generation).toBe(2);
      expect(db.prepare("SELECT send_status FROM speech_outbox").get()).toMatchObject({ send_status: "suppressed" });
      expect(db.prepare("SELECT state FROM wakes WHERE cycle_id = ?").get(cycle.cycleId)).toMatchObject({ state: "reconciling" });
    } finally {
      db.close();
    }
  });

  it("preempts when the current generation already has a delivered outbox", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "thread-delivered", triggerKind: "owner_message", triggerRef: "first",
        occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      insertOutboxPending(db, {
        settlementId: "settlement-delivered", cycleId: cycle.cycleId, generation: cycle.generation,
        conversationId: "thread-delivered", licensedText: "already delivered", origin: "live",
      });
      db.prepare("UPDATE speech_outbox SET send_status = 'delivered' WHERE settlement_id = 'settlement-delivered'").run();
      const result = composeOrPreempt(db, {
        conversationId: "thread-delivered", triggerRef: "owner-2", occupantId: "doc", authorityEpoch: 1, nowMs: 2,
      });
      expect(result.action).toBe("preempt");
      expect(result.generation).toBe(cycle.generation + 1);
    } finally {
      db.close();
    }
  });

  it("preempts and retires a zombie cycle (thinking with terminal wake) instead of composing into it", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "thread-zombie", triggerKind: "owner_message", triggerRef: "first",
        occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      updateCycleState(db, cycle.cycleId, "thinking", 2);
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed', updated_at_ms = 3 WHERE wake_id = ?").run(cycle.wakeId);

      const evidence = appendOwnerUtterance(db, {
        conversationId: "thread-zombie", text: "message after zombie", discordMessageIds: ["d-zombie"], nowMs: 4,
      });
      const result = composeOrPreempt(db, {
        conversationId: "thread-zombie", evidenceRowIds: [evidence.rowId], triggerRef: evidence.rowId,
        occupantId: "doc", authorityEpoch: 1, nowMs: 5,
      });

      expect(result.action).toBe("preempt");
      expect(result.generation).toBe(cycle.generation + 1);
      expect(result.preemptedGeneration).toBe(cycle.generation);
      // Previous zombie cycle is retired to silent
      expect(db.prepare("SELECT state FROM cycle_records WHERE cycle_id = ?").get(cycle.cycleId)).toMatchObject({ state: "silent" });
    } finally {
      db.close();
    }
  });
});

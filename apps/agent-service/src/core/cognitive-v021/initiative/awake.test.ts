import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { advanceAfterglowWatermark, listUnreflectedRows } from "./afterglow.js";
import {
  AWAKE_FIRST_DELAY_MS,
  AWAKE_INTERVAL_MS,
  AWAKE_JITTER_MS,
  awakeJitterMs,
  awakePassFromPayload,
  readInnerState,
  tickAwake,
} from "./awake.js";
import type { IdleThoughtRunner } from "./idle.js";

const CONVERSATION = "thread-awake";
const T0 = Date.UTC(2026, 8, 29, 9, 0);
const MINUTE = 60_000;

function publishedRunner(): ReturnType<typeof vi.fn<IdleThoughtRunner>> {
  return vi.fn<IdleThoughtRunner>(async () => ({ published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 }));
}

function tick(db: DatabaseSync, nowMs: number, thought: IdleThoughtRunner, afterglowEnabled?: boolean) {
  return tickAwake(db, {
    conversationId: CONVERSATION,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs,
    thought,
    ...(afterglowEnabled === undefined ? {} : { afterglowEnabled }),
  });
}

/** What the kernel does after a Thought: the cycle rests and its event is settled. */
function settle(db: DatabaseSync): void {
  db.prepare("UPDATE inbox_events SET status = 'consumed' WHERE id LIKE 'awake:%' AND status = 'pending'").run();
  db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
}

describe("AWAKE rhythm", () => {
  it("starts 20 minutes out, then gives Ashley a pass of her own every three hours, jittered", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      expect(await tick(db, T0, thought)).toMatchObject({ outcome: "scheduled", nextAwakeAtMs: T0 + AWAKE_FIRST_DELAY_MS });
      expect(await tick(db, T0 + AWAKE_FIRST_DELAY_MS - 1, thought)).toMatchObject({ outcome: "not_due" });

      const first = await tick(db, T0 + AWAKE_FIRST_DELAY_MS, thought);
      expect(first).toMatchObject({ outcome: "ran", slot: 1 });
      const input = thought.mock.calls[0]![0];
      expect(input.trigger).toEqual({ kind: "idle_opportunity", ref: "awake:1" });
      expect(input.privateBudgetReservation.state).toBe("held");
      expect(awakePassFromPayload(input.event?.payload)).toEqual({ kind: "awake", slot: 1, sinceMs: 0 });
      const gap = first.nextAwakeAtMs! - (T0 + AWAKE_FIRST_DELAY_MS);
      expect(gap).toBeGreaterThanOrEqual(AWAKE_INTERVAL_MS - AWAKE_JITTER_MS);
      expect(gap).toBeLessThanOrEqual(AWAKE_INTERVAL_MS + AWAKE_JITTER_MS);

      settle(db);
      expect(await tick(db, first.nextAwakeAtMs! - 1, thought)).toMatchObject({ outcome: "not_due" });
      expect(await tick(db, first.nextAwakeAtMs!, thought)).toMatchObject({ outcome: "ran", slot: 2 });
      // Layering: the second pass consumes what happened since the first.
      expect(awakePassFromPayload(thought.mock.calls[1]![0].event?.payload)).toMatchObject({ sinceMs: T0 + AWAKE_FIRST_DELAY_MS });
    } finally {
      db.close();
    }
  });

  it("waits while the Owner conversation is live, and lets a due afterglow go first", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      await tick(db, T0, thought);
      appendOwnerUtterance(db, { conversationId: CONVERSATION, text: "back in a bit", nowMs: T0 + 15 * MINUTE, audienceAtCapture: "owner_private" });
      expect(await tick(db, T0 + AWAKE_FIRST_DELAY_MS, thought)).toMatchObject({ outcome: "engaged" });
      expect(await tick(db, T0 + 45 * MINUTE, thought)).toMatchObject({ outcome: "afterglow_first" });
      expect(thought).not.toHaveBeenCalled();

      const [row] = listUnreflectedRows(db, CONVERSATION, 10);
      advanceAfterglowWatermark(db, CONVERSATION, row!.seq, "reflected", T0 + 46 * MINUTE);
      expect(await tick(db, T0 + 47 * MINUTE, thought)).toMatchObject({ outcome: "ran", slot: 1 });
    } finally {
      db.close();
    }
  });

  it("does not wait forever for an afterglow that is switched off", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      await tick(db, T0, thought);
      appendOwnerUtterance(db, { conversationId: CONVERSATION, text: "night", nowMs: T0 + MINUTE, audienceAtCapture: "owner_private" });
      expect(await tick(db, T0 + 45 * MINUTE, thought, false)).toMatchObject({ outcome: "ran" });
    } finally {
      db.close();
    }
  });

  it("never runs while a turn is in progress, and never twice at once", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      await tick(db, T0, thought);
      admitTestCycle(db, { conversationId: CONVERSATION, triggerKind: "owner_message", triggerRef: "busy", occupantId: "doc", authorityEpoch: 1, nowMs: T0 });
      expect(await tick(db, T0 + AWAKE_FIRST_DELAY_MS, thought)).toMatchObject({ outcome: "busy" });
      db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);

      const ran = await tick(db, T0 + AWAKE_FIRST_DELAY_MS, thought);
      expect(ran).toMatchObject({ outcome: "ran", slot: 1 });
      db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
      expect(await tick(db, ran.nextAwakeAtMs!, thought)).toMatchObject({ outcome: "in_flight", slot: 1 });
      expect(thought).toHaveBeenCalledTimes(1);
      expect(readInnerState(db, CONVERSATION)).toMatchObject({ slot: 1 });
    } finally {
      db.close();
    }
  });

  it("jitters deterministically within twenty minutes either way", () => {
    const values = Array.from({ length: 50 }, (_, slot) => awakeJitterMs(CONVERSATION, slot));
    expect(values.every((value) => Math.abs(value) <= AWAKE_JITTER_MS)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(40);
    expect(awakeJitterMs(CONVERSATION, 7)).toBe(awakeJitterMs(CONVERSATION, 7));
  });
});

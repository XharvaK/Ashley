import { recordNight } from "../growth/night.js";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { advanceAfterglowWatermark, listUnreflectedRows } from "./afterglow.js";
import {
  NIGHT_DEFAULT_HOUR,
  NIGHT_MIN_SAMPLES,
  nextLocalHour,
  nightPassFromPayload,
  quietestHour,
  readNightState,
  tickNight,
} from "./night.js";
import type { IdleThoughtRunner } from "./idle.js";

const CONVERSATION = "thread-night";
const ZONE = "Etc/GMT-3"; // UTC+3
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026-10-01 00:30 UTC is 03:30 at UTC+3.
const T0 = Date.UTC(2026, 9, 1, 0, 30);
const FOUR_AM = Date.UTC(2026, 9, 1, 1, 0);

function publishedRunner(): ReturnType<typeof vi.fn<IdleThoughtRunner>> {
  return vi.fn<IdleThoughtRunner>(async () => ({ published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 }));
}

function tick(db: DatabaseSync, nowMs: number, thought: IdleThoughtRunner) {
  return tickNight(db, { conversationId: CONVERSATION, occupantId: "doc", authorityEpoch: 1, timeZone: ZONE, nowMs, thought });
}

function settle(db: DatabaseSync): void {
  db.prepare("UPDATE inbox_events SET status = 'consumed' WHERE id LIKE 'night:%' AND status = 'pending'").run();
  db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
}

describe("NIGHT rhythm", () => {
  it("learns the Owner's quietest local hour, and defaults to 04:00 until it can", () => {
    const db = openTestSidecar();
    try {
      expect(quietestHour(db, { nowMs: T0, timeZone: ZONE })).toBe(NIGHT_DEFAULT_HOUR);
      // The Owner writes at every hour except 09:00-11:00 local, where it is quietest.
      let n = 0;
      for (let day = 1; day <= 3; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
          if (hour >= 9 && hour <= 11) continue;
          appendOwnerUtterance(db, { conversationId: CONVERSATION, text: `m${n += 1}`, nowMs: T0 - day * DAY + (hour - 3) * HOUR, audienceAtCapture: "owner_private" });
        }
      }
      expect(n).toBeGreaterThanOrEqual(NIGHT_MIN_SAMPLES);
      expect(quietestHour(db, { nowMs: T0, timeZone: ZONE })).toBe(10);
    } finally {
      db.close();
    }
  });

  it("finds the next top of the given local hour", () => {
    expect(nextLocalHour(T0, 4, ZONE)).toBe(FOUR_AM);
    expect(nextLocalHour(FOUR_AM, 4, ZONE)).toBe(FOUR_AM + DAY);
    expect(nextLocalHour(T0, 23, "UTC")).toBe(Date.UTC(2026, 9, 1, 23, 0));
  });

  it("runs once a day at the quiet hour, carries the day it closes, and makes the night a full week in the long arc", async () => {
    const db = openTestSidecar();
    try {
      const thought = vi.fn<IdleThoughtRunner>(input => {
        const pass = nightPassFromPayload(input.event?.payload);
        if (pass?.weekly) recordNight(db, {
          cycleId: input.cycle.cycleId, pass, claim: { narrative: "I am becoming more patient." },
          timeZone: ZONE, dataClassification: "ordinary", nowMs: Number(input.event!.createdAtMs),
        });
        return { published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 };
      });
      expect(await tick(db, T0, thought)).toMatchObject({ outcome: "scheduled", quietHour: 4, nextNightAtMs: FOUR_AM });
      expect(await tick(db, FOUR_AM - 1, thought)).toMatchObject({ outcome: "not_due" });

      const first = await tick(db, FOUR_AM, thought);
      expect(first).toMatchObject({ outcome: "ran", slot: 1, weekly: false, nextNightAtMs: FOUR_AM + DAY });
      expect(thought.mock.calls[0]![0].trigger).toEqual({ kind: "idle_opportunity", ref: "night:1" });
      expect(nightPassFromPayload(thought.mock.calls[0]![0].event?.payload))
        .toEqual({ kind: "night", slot: 1, sinceMs: FOUR_AM - DAY, weekly: false, weekSinceMs: T0 });
      settle(db);

      for (let night = 2; night <= 8; night += 1) {
        const ran = await tick(db, FOUR_AM + (night - 1) * DAY, thought);
        expect(ran).toMatchObject({ outcome: "ran", slot: night });
        settle(db);
        // The rhythm began half an hour before night 1, so night 8 closes the first full week.
        if (night < 8) expect(ran.weekly).toBe(false);
        else expect(ran.weekly).toBe(true);
      }
      const eighth = nightPassFromPayload(thought.mock.calls[7]![0].event?.payload);
      expect(eighth).toMatchObject({ weekly: true, sinceMs: FOUR_AM + 6 * DAY, weekSinceMs: T0 });
      expect(readNightState(db, CONVERSATION)).toMatchObject({ slot: 8, lastWeeklyAtMs: FOUR_AM + 7 * DAY });
      // The next long arc is a week after this one.
      for (let night = 9; night <= 15; night += 1) {
        const ran = await tick(db, FOUR_AM + (night - 1) * DAY, thought);
        settle(db);
        expect(ran.weekly).toBe(night === 15);
      }
    } finally {
      db.close();
    }
  });

  it("waits for a live conversation and a due afterglow, and never runs twice at once", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      await tick(db, T0, thought);
      appendOwnerUtterance(db, { conversationId: CONVERSATION, text: "still up", nowMs: FOUR_AM - 10 * 60_000, audienceAtCapture: "owner_private" });
      expect(await tick(db, FOUR_AM, thought)).toMatchObject({ outcome: "engaged" });
      expect(await tick(db, FOUR_AM + HOUR, thought)).toMatchObject({ outcome: "afterglow_first" });
      const [row] = listUnreflectedRows(db, CONVERSATION, 10);
      advanceAfterglowWatermark(db, CONVERSATION, row!.seq, "reflected", FOUR_AM + HOUR);

      admitTestCycle(db, { conversationId: CONVERSATION, triggerKind: "owner_message", triggerRef: "busy", occupantId: "doc", authorityEpoch: 1, nowMs: FOUR_AM + HOUR });
      expect(await tick(db, FOUR_AM + HOUR, thought)).toMatchObject({ outcome: "busy" });
      db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);

      const late = await tick(db, FOUR_AM + 2 * HOUR, thought);
      // A late night still runs; the next one is tomorrow's quiet hour, at least 12 hours on.
      expect(late).toMatchObject({ outcome: "ran", slot: 1, nextNightAtMs: FOUR_AM + DAY });
      db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
      expect(await tick(db, FOUR_AM + DAY, thought)).toMatchObject({ outcome: "in_flight", slot: 1 });
      expect(thought).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("never runs twice in one day when the learned hour moves later", async () => {
    const db = openTestSidecar();
    try {
      const thought = publishedRunner();
      await tick(db, T0, thought);
      // Days ago the Owner wrote at every hour except 05:00-07:00 local: the quiet hour becomes 06:00.
      let n = 0;
      for (let day = 1; day <= 3; day += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
          if (hour >= 5 && hour <= 7) continue;
          appendOwnerUtterance(db, { conversationId: CONVERSATION, text: `m${n += 1}`, nowMs: T0 - day * DAY + (hour - 3) * HOUR, audienceAtCapture: "owner_private" });
        }
      }
      const ran = await tickNight(db, { conversationId: CONVERSATION, occupantId: "doc", authorityEpoch: 1, timeZone: ZONE, nowMs: FOUR_AM, thought, afterglowEnabled: false });
      expect(ran).toMatchObject({ outcome: "ran", quietHour: 6 });
      // Not today at 06:00, two hours later: tomorrow's.
      expect(ran.nextNightAtMs).toBe(FOUR_AM + DAY + 2 * HOUR);
    } finally {
      db.close();
    }
  });
});

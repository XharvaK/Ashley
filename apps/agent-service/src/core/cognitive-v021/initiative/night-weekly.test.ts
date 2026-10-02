// A weekly opportunity is consumed only by the durable narrative it actually stores.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { recordNight } from "../growth/night.js";
import { nightIsWeekly, nightPassFromPayload, readNightState, tickNight, WEEKLY_NARRATIVE_INTERVAL_MS } from "./night.js";
import type { IdleThoughtRunner } from "./idle.js";
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 0, 30);
const DUE = Date.UTC(2026, 9, 8, 1);
function tick(db: ReturnType<typeof openTestSidecar>, nowMs: number, thought: IdleThoughtRunner) {
  return tickNight(db, { conversationId: "weekly", occupantId: "doc", authorityEpoch: 1, timeZone: "Etc/GMT-3", nowMs, thought });
}
describe("P7a weekly narrative closure", () => {
  it("requires exactly seven days with no half-day slack", () => {
    const state = { lastWeeklyAtMs: null, rhythmStartedAtMs: START };
    expect(WEEKLY_NARRATIVE_INTERVAL_MS).toBe(7 * DAY);
    expect(nightIsWeekly(state, START + 7 * DAY - 1)).toBe(false);
    expect(nightIsWeekly(state, START + 7 * DAY)).toBe(true);
  });
  for (const published of [false, true]) it(`does not consume the week without a stored narrative (published=${published})`, async () => {
    const db = openTestSidecar(); try {
      const thought: IdleThoughtRunner = () => ({ published, acceptedSettlements: published ? 1 : 0, thoughtModelAttempts: 1 });
      await tick(db, START, thought);
      expect(await tick(db, DUE, thought)).toMatchObject({ outcome: "ran", weekly: true });
      expect(readNightState(db, "weekly")?.lastWeeklyAtMs).toBeNull();
      expect(db.prepare("SELECT * FROM self_narratives").all()).toEqual([]);
      expect(nightIsWeekly(readNightState(db, "weekly")!, DUE + DAY)).toBe(true);
    } finally { db.close(); }
  });
  it("advances the watermark after actual narrative storage and preserves it across tick completion", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START, () => ({ published: true }));
      await tick(db, DUE, input => {
        const pass = nightPassFromPayload(input.event?.payload)!;
        recordNight(db, { cycleId: input.cycle.cycleId, pass, claim: { narrative: "I am becoming more patient." }, timeZone: "Etc/GMT-3", dataClassification: "ordinary", nowMs: DUE });
        return { published: true, acceptedSettlements: 1 };
      });
      expect(db.prepare("SELECT created_at_ms FROM self_narratives").get()).toEqual({ created_at_ms: DUE });
      expect(readNightState(db, "weekly")?.lastWeeklyAtMs).toBe(DUE);
      expect(nightIsWeekly(readNightState(db, "weekly")!, DUE + 7 * DAY - 1)).toBe(false);
    } finally { db.close(); }
  });
  it("does not advance the watermark if narrative storage fails", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START, () => ({ published: true }));
      db.exec("CREATE TRIGGER deny_weekly_narrative BEFORE INSERT ON self_narratives BEGIN SELECT RAISE(ABORT,'fixture_narrative_failure'); END");
      await tick(db, DUE, input => {
        recordNight(db, { cycleId: input.cycle.cycleId, pass: nightPassFromPayload(input.event?.payload)!, claim: { narrative: "I am becoming more patient." }, timeZone: "Etc/GMT-3", dataClassification: "ordinary", nowMs: DUE });
        return { published: true };
      });
      expect(db.prepare("SELECT * FROM self_narratives").all()).toEqual([]);
      expect(readNightState(db, "weekly")?.lastWeeklyAtMs).toBeNull();
    } finally { db.close(); }
  });
});

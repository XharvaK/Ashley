import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import {
  applyPursuitOps, dueOwnTime, isOwnTimeClaim, isPursuitOps, markOwnTimeFired, recordOwnTime, takeDueOwnTime, willForThought,
  OWN_TIME_MIN_AHEAD_MS, PURSUITS_ACTIVE_MAX,
} from "./pursuits.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const HOUR = 60 * 60_000;

describe("C1 her pursuits", () => {
  it("starts, advances with notes, parks and finishes what she chose", () => {
    const db = openTestSidecar();
    try {
      applyPursuitOps(db, { cycleId: "c1", nowMs: NOW, ops: [{ start: { title: "Dub techno lineage", why: "Basic Channel keeps coming back to me", nextStep: "read about Chain Reaction" } }] });
      const [started] = willForThought(db, NOW)!.pursuits;
      expect(started).toMatchObject({ title: "Dub techno lineage", state: "active", nextStep: "read about Chain Reaction", touched: 1 });
      applyPursuitOps(db, { cycleId: "c2", nowMs: NOW + HOUR, ops: [{ id: started!.id, note: "Chain Reaction was the label", nextStep: "listen to Porter Ricks" }] });
      applyPursuitOps(db, { cycleId: "c3", nowMs: NOW + 2 * HOUR, ops: [{ id: started!.id, state: "finished" }] });
      const [after] = willForThought(db, NOW + 2 * HOUR)!.pursuits;
      expect(after).toMatchObject({ state: "finished", nextStep: "listen to Porter Ricks", touched: 3, endedAtMs: NOW + 2 * HOUR,
        notes: [{ atMs: NOW + HOUR, note: "Chain Reaction was the label" }] });
      // A cycle applies once.
      applyPursuitOps(db, { cycleId: "c3", nowMs: NOW + 3 * HOUR, ops: [{ id: started!.id, state: "active" }] });
      expect(willForThought(db, NOW + 3 * HOUR)!.pursuits[0]!.state).toBe("finished");
    } finally { db.close(); }
  });

  it("keeps at most seven active and says why it refused", () => {
    const db = openTestSidecar();
    try {
      for (let index = 0; index <= PURSUITS_ACTIVE_MAX; index++) {
        applyPursuitOps(db, { cycleId: `c${index}`, nowMs: NOW + index, ops: [{ start: { title: `p${index}`, why: "because" } }] });
      }
      const will = willForThought(db, NOW + 100)!;
      expect(will.pursuits.filter(pursuit => pursuit.state === "active")).toHaveLength(PURSUITS_ACTIVE_MAX);
      expect(will.recent!.at(-1)).toMatchObject({ ok: false, reason: "too_many_active" });
      applyPursuitOps(db, { cycleId: "x", nowMs: NOW + 200, ops: [{ id: "pursuit:none", note: "?" }] });
      expect(willForThought(db, NOW + 300)!.recent!.at(-1)).toMatchObject({ ok: false, reason: "no_such_pursuit" });
    } finally { db.close(); }
  });

  it("validates her pursuit changes", () => {
    expect(isPursuitOps([{ start: { title: "a", why: "b" } }])).toBe(true);
    expect(isPursuitOps([{ id: "pursuit:1", state: "parked" }])).toBe(true);
    expect(isPursuitOps([{ id: "pursuit:1" }])).toBe(false);
    expect(isPursuitOps([{ start: { title: "a" } }])).toBe(false);
    expect(isPursuitOps([{ id: "pursuit:1", state: "deleted" }])).toBe(false);
  });
});

describe("D1 her clock", () => {
  it("keeps the time she asked for, refuses too soon, and hands it to the pass that comes then", () => {
    const db = openTestSidecar();
    try {
      expect(recordOwnTime(db, { cycleId: "c1", nowMs: NOW, claim: { atMs: NOW + 60_000, for: "too soon" } })).toEqual({ ok: false, reason: "too_soon" });
      expect(recordOwnTime(db, { cycleId: "c2", nowMs: NOW, claim: { atMs: NOW + 2 * HOUR, for: "finish the Porter Ricks note", pursuitId: "pursuit:1" } })).toEqual({ ok: true });
      expect(willForThought(db, NOW)!.ownTime).toEqual([{ atMs: NOW + 2 * HOUR, for: "finish the Porter Ricks note", pursuitId: "pursuit:1" }]);
      expect(dueOwnTime(db, NOW + HOUR)).toEqual([]);
      expect(dueOwnTime(db, NOW + 2 * HOUR)).toHaveLength(1);
      const served: string[] = [];
      expect(takeDueOwnTime(db, NOW + 2 * HOUR, served)).toEqual([{ atMs: NOW + 2 * HOUR, for: "finish the Porter Ricks note", pursuitId: "pursuit:1" }]);
      // Serving the wish does not settle it: a pass that fails leaves it due.
      expect(served).toHaveLength(1);
      expect(dueOwnTime(db, NOW + 3 * HOUR)).toHaveLength(1);
      markOwnTimeFired(db, served, NOW + 2 * HOUR);
      expect(dueOwnTime(db, NOW + 3 * HOUR)).toEqual([]);
      expect(isOwnTimeClaim({ atMs: NOW + OWN_TIME_MIN_AHEAD_MS, for: "x" })).toBe(true);
      expect(isOwnTimeClaim({ atMs: NOW, for: "" })).toBe(false);
    } finally { db.close(); }
  });
});

describe("D1 a time she asked for wakes her own time", () => {
  it("routes a due wish to the AWAKE executor, and the pass's agenda shows what it was for", async () => {
    const { prospective } = await import("../cognitive-v021/thalamus/nuclei/prospective.js");
    const { runThalamusPass } = await import("../cognitive-v021/thalamus/integration.js");
    const { buildInnerAgenda } = await import("../cognitive-v021/initiative/agenda.js");
    const db = openTestSidecar();
    try {
      recordOwnTime(db, { cycleId: "c1", nowMs: NOW, claim: { atMs: NOW + HOUR, for: "read the Chain Reaction page" } });
      const due = dueOwnTime(db, NOW + HOUR);
      const candidates = prospective(due.map(wish => ({ eventId: `wish:${wish.wishId}`, observedAtMs: wish.atMs, refs: [wish.wishId],
        kind: "trigger" as const, dueAtMs: wish.atMs })), NOW + HOUR);
      const ran: string[] = [];
      const other = async () => { ran.push("other"); };
      await runThalamusPass(db, { ownerId: "owner", conversationId: "owner-thread", nowMs: NOW + HOUR, enabled: true, candidates, facts: [],
        context: { budgetAvailable: true, conversationClaimHeld: false, spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 },
        executors: { afterglow: other, night: other, idle: other, awake: async () => { ran.push("awake"); } } });
      expect(ran).toEqual(["awake"]);
      const agenda = buildInnerAgenda(db, { kind: "awake", slot: 1, sinceMs: 0 }, NOW + HOUR);
      expect(agenda.ownTimeDue).toEqual([{ atMs: NOW + HOUR, for: "read the Chain Reaction page" }]);
      // The pass did not settle, so the wish is still due and shown again.
      expect(buildInnerAgenda(db, { kind: "awake", slot: 2, sinceMs: 0 }, NOW + 2 * HOUR).ownTimeDue).toEqual([{ atMs: NOW + HOUR, for: "read the Chain Reaction page" }]);
      markOwnTimeFired(db, due.map(wish => wish.wishId), NOW + HOUR);
      expect(buildInnerAgenda(db, { kind: "awake", slot: 3, sinceMs: 0 }, NOW + 3 * HOUR).ownTimeDue).toBeUndefined();
    } finally { db.close(); }
  });
});

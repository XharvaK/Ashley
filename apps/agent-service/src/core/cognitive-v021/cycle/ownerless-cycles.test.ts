import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { getCurrentCycle, getCycle, updateCycleState } from "./inbox.js";
import { ZOMBIE_CYCLE_GRACE_MS, retireOwnerlessCycles } from "./reconcile.js";

function openCycle(conversationId: string) {
  const db = openTestSidecar();
  const cycle = admitTestCycle(db, { conversationId, triggerKind: "owner_message", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
  updateCycleState(db, cycle.cycleId, "thinking", 2);
  return { db, cycle };
}

describe("ownerless cycles are retired while the service runs", () => {
  it("keeps a cycle whose wake is live, and retires it once the wake ended and the grace passed", () => {
    const { db, cycle } = openCycle("owner-thread");
    expect(retireOwnerlessCycles(db, { nowMs: 2 + ZOMBIE_CYCLE_GRACE_MS })).toEqual([]);
    db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(cycle.wakeId);
    expect(retireOwnerlessCycles(db, { nowMs: 1 + ZOMBIE_CYCLE_GRACE_MS })).toEqual([]);
    expect(getCurrentCycle(db, "owner-thread")?.cycleId).toBe(cycle.cycleId);
    expect(retireOwnerlessCycles(db, { nowMs: 2 + ZOMBIE_CYCLE_GRACE_MS })).toEqual([cycle.cycleId]);
    expect(getCycle(db, cycle.cycleId)?.state).toBe("silent");
    expect(getCurrentCycle(db, "owner-thread")).toBeNull();
    expect(retireOwnerlessCycles(db, { nowMs: 10 * ZOMBIE_CYCLE_GRACE_MS })).toEqual([]);
  });

  it("leaves social conversations to the startup path, which proves their dispatch first", () => {
    const { db, cycle } = openCycle("room:somewhere");
    db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(cycle.wakeId);
    expect(retireOwnerlessCycles(db, { nowMs: 10 * ZOMBIE_CYCLE_GRACE_MS })).toEqual([]);
    expect(getCycle(db, cycle.cycleId)?.state).toBe("thinking");
  });
});

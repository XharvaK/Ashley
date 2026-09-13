import { describe, expect, it } from "vitest";
import { appendInboxEvent, getCycle, getInboxEvent } from "./inbox.js";
import { profileForTrigger, resolveOriginProfile } from "./origin-profile.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { createRepairEvent, settleDurableAttempt, startDurableAttempt } from "../retry/ledger.js";

describe("restoration origin profile derivation", () => {
  it("maps only the frozen A/B/C trigger classes", () => {
    expect(profileForTrigger("owner_message")).toBe("A");
    expect(profileForTrigger("observation_or_receipt")).toBe("B");
    expect(profileForTrigger("idle_opportunity")).toBe("C");
    expect(profileForTrigger("subscription_item")).toBe("C");
    expect(profileForTrigger("future_trigger_due")).toBe("C");
    expect(profileForTrigger("recovery")).toBeNull();
  });

  it("reconstructs effect recovery from the authoritative originating cycle", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-recovery-origin",
        conversationId: "thread-recovery-origin",
        triggerKind: "owner_message",
        triggerRef: "owner-origin",
        occupantId: "doc",
        nowMs: 1,
      });
      const event = appendInboxEvent(db, {
        conversationId: cycle.conversationId,
        kind: "recovery",
        payload: { cycleId: cycle.cycleId, effectId: "effect-1" },
        id: "recovery-event-1",
        createdAtMs: 2,
      });
      const resolved = resolveOriginProfile(db, event, cycle);
      expect(resolved).toMatchObject({
        profile: "A",
        triggerKind: "owner_message",
        originCycleId: cycle.cycleId,
        source: "payload_cycle",
      });
    } finally {
      db.close();
    }
  });

  it("reconstructs owner-authorized repair from predecessor lineage without persisting profile authority", () => {
    const db = openTestSidecar();
    try {
      const original = admitTestCycle(db, {
        cycleId: "cycle-repair-origin",
        conversationId: "thread-repair-origin",
        triggerKind: "future_trigger_due",
        triggerRef: "future-origin",
        occupantId: "doc",
        nowMs: 1,
      });
      const predecessor = appendInboxEvent(db, {
        conversationId: original.conversationId,
        kind: "future_trigger_due",
        payload: { cycleId: original.cycleId },
        id: "predecessor-event-1",
        createdAtMs: 2,
      });
      const attempt = startDurableAttempt(db, { eventId: predecessor.id, workerId: "worker", nowMs: 3 });
      settleDurableAttempt(db, {
        eventId: predecessor.id,
        attemptId: attempt.attemptId,
        claimToken: attempt.claimToken,
        result: { kind: "outcome_unknown", operationId: predecessor.id, errorCode: "timeout" },
        nowMs: 4,
      });
      const repair = createRepairEvent(db, {
        predecessorEventId: predecessor.id,
        authorizationRef: "owner-review:repair-origin",
        nowMs: 5,
        payload: { referenceOnly: true },
      });
      const repairEvent = getInboxEvent(db, repair.id);
      const repairCycle = repairEvent ? getCycle(db, repairEvent.wakeId ? (db.prepare("SELECT cycle_id FROM wakes WHERE wake_id = ?").get(repairEvent.wakeId) as { cycle_id: string }).cycle_id : "") : null;
      if (!repairEvent || !repairCycle) throw new Error("repair_lineage_missing");
      const resolved = resolveOriginProfile(db, repairEvent, repairCycle);
      expect(resolved).toMatchObject({ profile: "C", triggerKind: "future_trigger_due", source: "predecessor_event" });
      expect(db.prepare("PRAGMA table_info(cycle_records)").all()).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "semantic_profile" }),
      ]));
    } finally {
      db.close();
    }
  });

  it("fails closed when recovery has no reconstructible A/B/C origin", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-recovery-missing",
        conversationId: "thread-recovery-missing",
        triggerKind: "recovery",
        triggerRef: "recovery-only",
        occupantId: "doc",
        nowMs: 1,
      });
      const event = appendInboxEvent(db, {
        conversationId: cycle.conversationId,
        kind: "recovery",
        payload: { cycleId: cycle.cycleId },
        id: "recovery-event-missing",
        createdAtMs: 2,
      });
      expect(resolveOriginProfile(db, event, cycle)).toBeNull();
    } finally {
      db.close();
    }
  });
});

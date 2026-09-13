import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import { insertDeferredFrontierRecord } from "../../frontier/ledger.js";
import { cancelWake, admitWake, finishWake } from "../../wake/ledger.js";
import { occurrenceIdFor } from "../../wake/identity.js";
import { tickIdleOpportunity } from "../idle.js";

function seedActiveOccupancy(db: ReturnType<typeof openTestSidecar>, conversationId: string): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, status, snapshot_hash, updated_cycle)
     VALUES (?, ?, 'active frontier concern', '[]', '{}', NULL, 'active', 'snapshot-idle-frontier', NULL)`,
  ).run(`concern-${conversationId}`, conversationId);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES (?, ?, 'active', 20, 'cycle-idle-frontier', 1)`,
  ).run(conversationId, `concern-${conversationId}`);
}

function seedIdleWake(db: ReturnType<typeof openTestSidecar>, conversationId: string, triggerRef: string, nowMs: number): string {
  const admission = admitWake(db, {
    occurrenceId: occurrenceIdFor({ sourceKind: "idle", triggerRef, conversationId }),
    triggerRef,
    sourceKind: "idle",
    conversationId,
    triggerKind: "idle_opportunity",
    occupantId: "private",
    authorityEpoch: 1,
    capturedAuthorityRevision: 0,
    nowMs,
  });
  if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("test_idle_wake_terminal");
  return admission.wake.wakeId;
}

describe("W9 idle frontier and wake suppression", () => {
  it("suppresses idle evaluation behind an active deferred frontier", async () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-idle-frontier";
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-idle-frontier",
        conversationId,
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "frontier-seed",
        occupantId: "owner",
        authorityEpoch: 1,
        nowMs: 1,
      });
      insertDeferredFrontierRecord(db, {
        frontierId: "frontier-idle-suppression",
        conversationId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        nextEligibleAtMs: 200,
        latestEvidenceRowId: "evidence-idle-frontier",
        nowMs: 100,
      });
      seedActiveOccupancy(db, conversationId);

      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId,
        nowMs: 100,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(result).toMatchObject({
        eligible: false,
        idleEligible: false,
        reason: "active_frontier",
        thoughtCalls: 0,
        semanticAbsenceClaim: "no",
      });
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("classifies a cancelled wake as wake_cancelled, not empty_house", async () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-idle-cancelled";
      const triggerRef = "concern-thread-idle-cancelled:tick:100";
      seedActiveOccupancy(db, conversationId);
      const wakeId = seedIdleWake(db, conversationId, triggerRef, 100);
      cancelWake(db, { wakeId, nowMs: 101 });

      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId,
        nowMs: 100,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(result).toMatchObject({
        eligible: false,
        idleEligible: false,
        reason: "wake_cancelled",
        thoughtCalls: 0,
        semanticAbsenceClaim: "no",
      });
      expect(result.reason).not.toBe("empty_house");
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("classifies an expired wake as wake_stale, not empty_house", async () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-idle-stale";
      const triggerRef = "concern-thread-idle-stale:tick:100";
      seedActiveOccupancy(db, conversationId);
      const wakeId = seedIdleWake(db, conversationId, triggerRef, 100);
      finishWake(db, wakeId, null, "expired", 101);

      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId,
        nowMs: 100,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(result).toMatchObject({
        eligible: false,
        idleEligible: false,
        reason: "wake_stale",
        thoughtCalls: 0,
        semanticAbsenceClaim: "no",
      });
      expect(result.reason).not.toBe("empty_house");
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });
});

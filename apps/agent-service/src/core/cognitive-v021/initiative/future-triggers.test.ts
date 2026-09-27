import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import {
  cancelFutureTrigger,
  fireDueTriggers,
  futureTriggerWakeContext,
  getFutureTrigger,
  listFutureTriggers,
  matureFutureTriggerToWake,
  scheduleFutureTrigger,
} from "./future-triggers.js";

function seedConcern(
  db: ReturnType<typeof openTestSidecar>,
  status: "active" | "resolved" | "dormant_but_revisitable" = "active",
  snapshotHash = "snapshot-1",
): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, cognitive_status, snapshot_hash, updated_cycle)
     VALUES ('concern-1', 'thread-trigger', 'inspect HY3', '[]', '{}', NULL, ?, ?, NULL)`,
  ).run(status, snapshotHash);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES ('thread-trigger', 'concern-1', ?, 10, 'cycle-seed', 1)`,
  ).run(status);
}

describe("v0.2.1 FutureTrigger fence", () => {
  it("suppresses a due trigger after occupancy resolves without calling Thought", async () => {
    const db = openTestSidecar();
    try {
      seedConcern(db, "resolved");
      scheduleFutureTrigger(db, { triggerId: "future-resolved", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10, payload: { concernId: "concern-1" } });
      const result = await fireDueTriggers(db, { nowMs: 10 });
      expect(result.thoughtModelAttempts).toBe(0);
      expect(result.suppressedStale).toHaveLength(1);
      expect(db.prepare("SELECT status FROM future_triggers WHERE trigger_id = 'future-resolved'").get()).toMatchObject({ status: "suppressed_stale" });
      const wake = db.prepare("SELECT wake_id FROM future_triggers WHERE trigger_id = 'future-resolved'").get() as { wake_id: string };
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wake.wake_id)).toMatchObject({ state: "terminal", terminal_reason: "no_action" });
      expect(db.prepare("SELECT payload_json FROM causal_ledger WHERE cycle_id = 'future-trigger:future-resolved'").get()).toMatchObject({ payload_json: expect.stringContaining("suppressed_stale") });
    } finally {
      db.close();
    }
  });

  it("admits one bounded reconsideration wake when the concern snapshot hash changed", async () => {
    const db = openTestSidecar();
    try {
      seedConcern(db, "active", "snapshot-new");
      scheduleFutureTrigger(db, { triggerId: "future-hash", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-old", dueAtMs: 10 });
      const result = await fireDueTriggers(db, { nowMs: 10 });
      expect(result.suppressedStale).toHaveLength(0);
      expect(result.fired).toHaveLength(1);
      expect(result.thoughtModelAttempts).toBe(0);
      expect(getFutureTrigger(db, "future-hash")).toMatchObject({ status: "needs_review" });
      const wake = db.prepare("SELECT wake_id FROM future_triggers WHERE trigger_id = 'future-hash'").get() as { wake_id: string };
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wake.wake_id)).toMatchObject({ state: "pending", terminal_reason: null });
      expect(futureTriggerWakeContext(db, "future-hash")).toMatchObject({
        sourceKind: "future_trigger",
        triggerRef: "future-hash",
        bindingState: "broken",
        bindingReason: "snapshot_mismatch",
        concernRevision: "snapshot-new",
      });
      const replay = await fireDueTriggers(db, { nowMs: 11 });
      expect(replay.fired).toHaveLength(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = 'future-trigger:future-hash'").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("preserves the authored purpose and bounded trigger metadata for Thought", () => {
    const db = openTestSidecar();
    try {
      seedConcern(db);
      scheduleFutureTrigger(db, {
        triggerId: "future-purpose",
        conversationId: "thread-trigger",
        concernId: "concern-1",
        snapshotHash: "snapshot-1",
        dueAtMs: 42,
        evidenceRefs: ["evidence:one"],
        timingPolicyId: "owner-window-v1",
        payload: { purpose: "revisit the bounded concern", statement: "must not enter the inbox" },
      });
      expect(futureTriggerWakeContext(db, "future-purpose")).toMatchObject({
        sourceKind: "future_trigger",
        triggerRef: "future-purpose",
        purpose: "revisit the bounded concern",
        purposeStatus: "stored",
        triggerPurpose: "revisit the bounded concern",
        dueAtMs: 42,
        concernId: "concern-1",
        concernRevision: "snapshot-1",
        evidenceRefs: ["evidence:one"],
        timingPolicyId: "owner-window-v1",
        cancellationState: "not_cancelled",
        bindingState: "intact",
      });
    } finally {
      db.close();
    }
  });

  it("fires an explicit trigger for a dormant-but-revisitable concern", async () => {
    const db = openTestSidecar();
    try {
      seedConcern(db, "dormant_but_revisitable");
      scheduleFutureTrigger(db, { triggerId: "future-dormant", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10 });
      const result = await fireDueTriggers(db, { nowMs: 10 });
      expect(result.fired.map((trigger) => trigger.triggerId)).toEqual(["future-dormant"]);
      expect(result.suppressedStale).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("keeps quarantined occupancy on the suppression path", async () => {
    const db = openTestSidecar();
    try {
      seedConcern(db);
      db.prepare("UPDATE concerns SET quarantine_kind = 'legacy_unavailable_source' WHERE concern_id = 'concern-1'").run();
      scheduleFutureTrigger(db, { triggerId: "future-quarantine", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10 });
      const result = await fireDueTriggers(db, { nowMs: 10 });
      expect(result.suppressedStale.map((trigger) => trigger.triggerId)).toEqual(["future-quarantine"]);
      expect(result.fired).toHaveLength(0);
      expect(getFutureTrigger(db, "future-quarantine")).toMatchObject({ status: "suppressed_stale" });
    } finally {
      db.close();
    }
  });

  it("cancels an admitted but not-yet-running wake", () => {
    const db = openTestSidecar();
    try {
      seedConcern(db);
      scheduleFutureTrigger(db, { triggerId: "future-cancel", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10 });
      const admitted = matureFutureTriggerToWake(db, "future-cancel", { nowMs: 10 });
      expect(admitted?.kind).toBe("created");
      expect(cancelFutureTrigger(db, "future-cancel", 11)).toBe(true);
      expect(getFutureTrigger(db, "future-cancel")).toMatchObject({ status: "cancelled" });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(admitted!.wake.wakeId)).toMatchObject({ state: "terminal", terminal_reason: "cancelled" });
    } finally {
      db.close();
    }
  });

  it("fires a valid trigger once and stores only references in the inbox event", async () => {
    const db = openTestSidecar();
    try {
      seedConcern(db);
      scheduleFutureTrigger(db, { triggerId: "future-valid", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10, payload: { concernId: "concern-1", label: "HY3" } });
      let calls = 0;
      const result = await fireDueTriggers(db, {
        nowMs: 10,
        onFire: async ({ trigger }) => {
          calls += 1;
          expect(trigger.triggerId).toBe("future-valid");
          return { thoughtModelAttempts: 1 };
        },
      });
      expect(result.fired).toHaveLength(1);
      expect(result.thoughtModelAttempts).toBe(1);
      expect(calls).toBe(1);
      const event = db.prepare("SELECT kind, payload_json FROM inbox_events WHERE id = 'future-trigger:future-valid'").get() as { kind: string; payload_json: string };
      expect(event.kind).toBe("future_trigger_due");
      expect(event.payload_json).not.toContain("inspect HY3");
      await expect(fireDueTriggers(db, { nowMs: 11 })).resolves.toMatchObject({ fired: [], thoughtModelAttempts: 0 });
      expect(listFutureTriggers(db, "thread-trigger")).toEqual([expect.objectContaining({ status: "fired" })]);
    } finally {
      db.close();
    }
  });

  it("converges repeated maturity after a restart onto one wake, cycle, and inbox event", () => {
    const db = openTestSidecar();
    try {
      seedConcern(db);
      scheduleFutureTrigger(db, { triggerId: "future-replay", conversationId: "thread-trigger", concernId: "concern-1", snapshotHash: "snapshot-1", dueAtMs: 10 });

      const first = matureFutureTriggerToWake(db, "future-replay", { nowMs: 10, capturedAuthorityRevision: 4 });
      const second = matureFutureTriggerToWake(db, "future-replay", { nowMs: 10_000, capturedAuthorityRevision: 99 });

      expect(first).toMatchObject({ kind: "created" });
      expect(second).toMatchObject({ kind: "existing" });
      expect(second?.wake.wakeId).toBe(first?.wake.wakeId);
      expect(second?.wake.cycleId).toBe(first?.wake.cycleId);
      expect(second?.event?.id).toBe(first?.event?.id);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM cycle_records").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get() as { count: number }).count).toBe(1);
      expect(db.prepare("SELECT wake_id FROM future_triggers WHERE trigger_id = 'future-replay'").get()).toMatchObject({ wake_id: first?.wake.wakeId });
    } finally {
      db.close();
    }
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import {
  beginAuthorityTransition,
  markAuthorityBarrierReconciling,
  readAuthorityBarrier,
  stabilizeAuthorityBarrier,
} from "./barrier.js";
import { advanceCanonicalOwnerVersionInTransaction, readAuthorityVersionVector } from "./version-vector.js";
import { recordDerivedInvalidationInTransaction, readDerivedInvalidation } from "./journal.js";

describe("authority transition barrier", () => {
  it("serializes transitions, advances owner vectors, and journals invalidation atomically", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(readAuthorityBarrier(db).state).toBe("stable");
      const started = beginAuthorityTransition(db, "test", 12);
      expect(started.state).toBe("transitioning");
      expect(started.epoch).toBe(1);
      expect(() => beginAuthorityTransition(db, "second", 13)).toThrow("authority_transition_active");

      db.exec("BEGIN IMMEDIATE");
      try {
        const entry = recordDerivedInvalidationInTransaction({
          db,
          changeId: "change-barrier-1",
          ownerId: "doc",
          conversationId: "thread-1",
          sourceRefs: ["v021_memory_assertion:memory-1"],
          invalidationKind: "redaction",
          canonicalOwner: "nuclear",
          targetGeneration: 4,
          nowMs: 13,
        });
        expect(entry).toMatchObject({
          changeId: "change-barrier-1",
          canonicalVersion: 1,
          state: "pending",
        });
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
        throw error;
      }

      expect(readAuthorityVersionVector(db)).toEqual({ nuclear: 1, continuity: 0, cognitive_sidecar: 0 });
      expect(readDerivedInvalidation(db, "change-barrier-1")).toMatchObject({ state: "pending" });
      const stable = stabilizeAuthorityBarrier(db, readAuthorityVersionVector(db), 14, started.transitionId);
      expect(stable.state).toBe("stable");
      expect(stable.vector).toEqual({ nuclear: 1, continuity: 0, cognitive_sidecar: 0 });
    } finally {
      db.close();
    }
  });

  it("preserves the active transition identity across recovery and idempotent reapplication", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const started = beginAuthorityTransition(db, "test-recovery", 12);

      const firstRecovery = markAuthorityBarrierReconciling(db, "owner_commit_pending", 13);
      expect(firstRecovery).toMatchObject({
        state: "reconciling",
        activeTransitionId: started.transitionId,
        reasonCode: "owner_commit_pending",
      });

      const repeatedRecovery = markAuthorityBarrierReconciling(db, "projection_retry", 14);
      expect(repeatedRecovery).toMatchObject({
        state: "reconciling",
        activeTransitionId: started.transitionId,
        reasonCode: "projection_retry",
      });
    } finally {
      db.close();
    }
  });

  it("rejects stable-to-reconciling because recovery requires a non-stable source state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(readAuthorityBarrier(db)).toMatchObject({ state: "stable", activeTransitionId: null });
      expect(() => markAuthorityBarrierReconciling(db, "invalid_stable_recovery", 12))
        .toThrow("authority_barrier_reconcile_source_invalid");
      expect(readAuthorityBarrier(db)).toMatchObject({ state: "stable", activeTransitionId: null });
    } finally {
      db.close();
    }
  });
});

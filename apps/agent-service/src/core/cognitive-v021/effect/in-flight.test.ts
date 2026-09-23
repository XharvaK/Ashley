import { describe, expect, it } from "vitest";
import {
  getEffectReceipt,
  getInFlight,
  listInFlightForThoughtCycle,
  markInFlightUnknown,
  putInFlight,
  recordEffectReceipt,
} from "./in-flight.js";
import { appendInboxEvent, claimInboxEvent } from "../cycle/inbox.js";
import { mintEffectRef } from "./effect-ref.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";

describe("v0.2.1 in-flight effect pointers", () => {
  it("deduplicates by idempotency key and preserves unknown timeout", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-1",
        conversationId: "thread-1",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-1",
        occupantId: "doc",
        nowMs: 1,
      });
      const first = putInFlight(db, {
        effectId: "effect-1", cycleId: "cycle-1", generation: 1, correlationId: "corr-1",
        idempotencyKey: "idem-1", dispatchedAtMs: 10, originEventId: "event-1",
      });
      const duplicate = putInFlight(db, {
        effectId: "effect-2", cycleId: "cycle-1", generation: 1, correlationId: "corr-2",
        idempotencyKey: "idem-1", dispatchedAtMs: 11, originEventId: "event-1",
      });
      expect(duplicate.effectId).toBe(first.effectId);
      markInFlightUnknown(db, first.effectId, 20);
      expect(getInFlight(db, first.effectId)).toMatchObject({ status: "unknown" });
    } finally {
      db.close();
    }
  });

  it("truthfully records and maps five-way receipt outcomes", () => {
    const db = openTestSidecar();
    try {
      const outcomes = ["succeeded", "failed", "outcome_unknown", "not_attempted", "in_progress"] as const;
      for (const outcome of outcomes) {
        const receipt = {
          receiptId: `rec-${outcome}`,
          effectId: `eff-${outcome}`,
          idempotencyKey: `idem-${outcome}`,
          outcome,
          claims: {},
          atMs: 100,
          dataClassification: "never_public" as const,
          secretOmitted: true,
        };
        const recorded = recordEffectReceipt(db, receipt);
        expect(recorded.outcome).toBe(outcome);
        const retrieved = getEffectReceipt(db, `eff-${outcome}`);
        expect(retrieved?.outcome).toBe(outcome);
      }

      // Legacy 'unknown' maps to 'outcome_unknown'
      db.prepare(`INSERT INTO effect_receipts (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms, data_classification, secret_omitted)
        VALUES ('rec-legacy', 'eff-legacy', 'idem-legacy', 'unknown', '{}', 100, 'never_public', 0)`).run();
      expect(getEffectReceipt(db, "eff-legacy")?.outcome).toBe("outcome_unknown");

      // Invalid outcome throws
      expect(() => recordEffectReceipt(db, {
        receiptId: "rec-bad",
        effectId: "eff-bad",
        idempotencyKey: "idem-bad",
        outcome: "completed" as any,
        claims: {},
        atMs: 100,
        dataClassification: "never_public",
        secretOmitted: false,
      })).toThrow("invalid_receipt_outcome:completed");
    } finally {
      db.close();
    }
  });

  it("enforces originEventId at runtime and maps causal provenance", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-prov",
        conversationId: "thread-prov",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-prov",
        occupantId: "doc",
        nowMs: 1,
      });

      // Missing originEventId throws
      expect(() => putInFlight(db, {
        effectId: "effect-no-origin",
        cycleId: "cycle-prov",
        generation: 1,
        correlationId: "corr-no-origin",
        idempotencyKey: "idem-no-origin",
        dispatchedAtMs: 10,
        originEventId: "" as any,
      })).toThrow("origin_event_id_required");

      // Valid originEventId and originAttemptId recorded and mapped
      const cycleRow = db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = 'cycle-prov'").get() as { wake_id: string };
      db.prepare(`INSERT INTO durable_work_attempts (attempt_id, event_id, wake_id, ordinal, worker_id, started_at_ms, dispatch_truth)
        VALUES ('attempt-prov-1', 'event-prov', ?, 1, 'worker-1', 1, 'attempted')`).run(cycleRow.wake_id);

      const record = putInFlight(db, {
        effectId: "effect-prov",
        cycleId: "cycle-prov",
        generation: 1,
        correlationId: "corr-prov",
        idempotencyKey: "idem-prov",
        dispatchedAtMs: 10,
        originEventId: "event-prov",
        originAttemptId: "attempt-prov-1",
      });
      expect(record.originEventId).toBe("event-prov");
      expect(record.originAttemptId).toBe("attempt-prov-1");

      const fetched = getInFlight(db, "effect-prov");
      expect(fetched?.originEventId).toBe("event-prov");
      expect(fetched?.originAttemptId).toBe("attempt-prov-1");
    } finally {
      db.close();
    }
  });

  it("retains the authored operation kind and request separately from legacy payloads", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-bclp-kind",
        conversationId: "thread-bclp-kind",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-kind",
        occupantId: "owner",
        nowMs: 1,
      });
      putInFlight(db, {
        effectId: "effect-bclp-kind",
        cycleId: "cycle-bclp-kind",
        generation: 1,
        correlationId: "corr-bclp-kind",
        idempotencyKey: "idem-bclp-kind",
        payload: { projectId: "project-ashley", path: "README.md" },
        operationKind: "workspace.verify",
        originEventId: "event-bclp-kind",
      });
      expect(listInFlightForThoughtCycle(db, "cycle-bclp-kind")[0]).toMatchObject({
        operationKind: "workspace.verify",
        request: { projectId: "project-ashley", path: "README.md" },
      });
    } finally {
      db.close();
    }
  });

  it("does not treat a legacy request that resembles host metadata as an envelope", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-bclp-legacy-envelope",
        conversationId: "thread-bclp-legacy-envelope",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-legacy-envelope",
        occupantId: "owner",
        nowMs: 1,
      });
      const request = {
        __ashleyBclp: { semanticOperationKind: "workspace.verify" },
        request: { projectId: "project-ashley", path: "README.md" },
      };
      putInFlight(db, {
        effectId: "effect-bclp-legacy-envelope",
        cycleId: "cycle-bclp-legacy-envelope",
        generation: 1,
        correlationId: "corr-bclp-legacy-envelope",
        idempotencyKey: "idem-bclp-legacy-envelope",
        payload: request,
        originEventId: "event-bclp-legacy-envelope",
      });

      expect(getInFlight(db, "effect-bclp-legacy-envelope")).toMatchObject({ request });
      expect(getInFlight(db, "effect-bclp-legacy-envelope")).not.toHaveProperty("operationKind");
    } finally {
      db.close();
    }
  });

  it("retains owner-DM audience scope from the host envelope", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-bclp-owner-dm",
        conversationId: "thread-bclp-owner-dm",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-owner-dm",
        occupantId: "owner",
        nowMs: 1,
      });
      putInFlight(db, {
        effectId: "effect-bclp-owner-dm",
        cycleId: "cycle-bclp-owner-dm",
        generation: 1,
        correlationId: "corr-bclp-owner-dm",
        idempotencyKey: "idem-bclp-owner-dm",
        payload: { projectId: "project-ashley" },
        operationKind: "workspace.verify",
        audienceScope: { kind: "owner_dm", threadId: "thread-bclp-owner-dm" },
        originEventId: "event-bclp-owner-dm",
      });

      expect(listInFlightForThoughtCycle(db, "cycle-bclp-owner-dm")[0]).toMatchObject({
        operationKind: "workspace.verify",
        audienceScope: { kind: "owner_dm", threadId: "thread-bclp-owner-dm" },
      });
    } finally {
      db.close();
    }
  });

  it("carries only mechanically correlated effects through the admitted preemption chain", () => {
    const db = openTestSidecar();
    try {
      const predecessor = admitTestCycle(db, {
        cycleId: "cycle-bclp-parent",
        conversationId: "thread-bclp-chain",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-parent",
        occupantId: "owner",
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-bclp-child",
        conversationId: "thread-bclp-chain",
        generation: 2,
        preemptedGeneration: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-child",
        occupantId: "owner",
        nowMs: 2,
      });
      admitTestCycle(db, {
        cycleId: "cycle-bclp-unrelated",
        conversationId: "thread-bclp-chain",
        generation: 3,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-unrelated",
        occupantId: "owner",
        nowMs: 3,
      });
      admitTestCycle(db, {
        cycleId: "cycle-bclp-disconnected",
        conversationId: "thread-bclp-chain",
        generation: 4,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-disconnected",
        occupantId: "owner",
        nowMs: 4,
      });
      const attemptWake = admitTestCycle(db, {
        cycleId: "cycle-bclp-attempt-wake",
        conversationId: "thread-bclp-chain",
        generation: 5,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-attempt-wake",
        occupantId: "owner",
        nowMs: 5,
      });
      const acceptedRefWake = admitTestCycle(db, {
        cycleId: "cycle-bclp-accepted-ref-wake",
        conversationId: "thread-bclp-chain",
        generation: 6,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-accepted-ref-wake",
        occupantId: "owner",
        nowMs: 6,
      });

      putInFlight(db, {
        effectId: "effect-bclp-parent-linked",
        cycleId: predecessor.cycleId,
        generation: 1,
        correlationId: "corr-bclp-parent-linked",
        idempotencyKey: "idem-bclp-parent-linked",
        originEventId: "event-bclp-parent",
        operationKind: "workspace.verify",
      });
      db.prepare("UPDATE cycle_records SET compose_log_ids_json = ? WHERE cycle_id = ?")
        .run(JSON.stringify(["compose-only-row"]), predecessor.cycleId);
      db.prepare(
        `INSERT INTO inbox_events (id, conversation_id, kind, payload_json, created_at_ms, status)
         VALUES (?, ?, 'test', '{}', 5, 'claimed')`,
      ).run("compose-only-row", "thread-bclp-chain");
      const disconnectedWakeId = (db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?")
        .get("cycle-bclp-disconnected") as { wake_id: string }).wake_id;
      const childWakeId = (db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?")
        .get("cycle-bclp-child") as { wake_id: string }).wake_id;
      const attemptEvent = appendInboxEvent(db, {
        id: "event-bclp-attempt-only",
        wakeId: childWakeId,
        conversationId: "thread-bclp-chain",
        kind: "test",
        payload: { cycleId: "cycle-bclp-child" },
        createdAtMs: 6,
      });
      const attempt = claimInboxEvent(db, {
        workerId: "test-attempt",
        eventId: attemptEvent.id,
        nowMs: 7,
      });
      if (!attempt?.durableAttemptId) throw new Error("attempt_not_claimed");
      putInFlight(db, {
        effectId: "effect-bclp-compose-only",
        cycleId: predecessor.cycleId,
        generation: 1,
        wakeId: disconnectedWakeId,
        correlationId: "corr-bclp-compose-only",
        idempotencyKey: "idem-bclp-compose-only",
        originEventId: "compose-only-row",
      });
      putInFlight(db, {
        effectId: "effect-bclp-attempt-linked",
        cycleId: predecessor.cycleId,
        generation: 1,
        wakeId: attemptWake.wakeId,
        correlationId: "corr-bclp-attempt-linked",
        idempotencyKey: "idem-bclp-attempt-linked",
        originEventId: "compose-only-row",
        originAttemptId: attempt.durableAttemptId,
      });
      putInFlight(db, {
        effectId: "effect-bclp-accepted-current-ref",
        cycleId: predecessor.cycleId,
        generation: 1,
        wakeId: acceptedRefWake.wakeId,
        correlationId: "corr-bclp-accepted-current-ref",
        idempotencyKey: "idem-bclp-accepted-current-ref",
        originEventId: "compose-only-row",
      });
      putInFlight(db, {
        effectId: "effect-bclp-child",
        cycleId: "cycle-bclp-child",
        generation: 2,
        correlationId: "corr-bclp-child",
        idempotencyKey: "idem-bclp-child",
        originEventId: "event-bclp-child",
      });
      putInFlight(db, {
        effectId: "effect-bclp-unrelated",
        cycleId: "cycle-bclp-unrelated",
        generation: 3,
        correlationId: "corr-bclp-unrelated",
        idempotencyKey: "idem-bclp-unrelated",
        originEventId: "event-bclp-unrelated",
      });
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run("settlement-bclp-current-ref", "cycle-bclp-child", 2, JSON.stringify({
        commitments: {
          operational: [{
            effectRef: mintEffectRef("cycle-bclp-child", 2, "effect-bclp-accepted-current-ref"),
            claimedState: "succeeded",
          }],
        },
      }));

      expect(listInFlightForThoughtCycle(db, "cycle-bclp-child").map((row) => row.effectId).sort()).toEqual([
        "effect-bclp-accepted-current-ref",
        "effect-bclp-attempt-linked",
        "effect-bclp-child",
        "effect-bclp-parent-linked",
      ]);
    } finally {
      db.close();
    }
  });

  it("releases a linked consequence only when an accepted settlement names that effect", () => {
    const db = openTestSidecar();
    try {
      const predecessor = admitTestCycle(db, {
        cycleId: "cycle-bclp-release-parent",
        conversationId: "thread-bclp-release",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-release-parent",
        occupantId: "owner",
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-bclp-release-middle",
        conversationId: "thread-bclp-release",
        generation: 2,
        preemptedGeneration: 1,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-release-middle",
        occupantId: "owner",
        nowMs: 2,
      });
      admitTestCycle(db, {
        cycleId: "cycle-bclp-release-child",
        conversationId: "thread-bclp-release",
        generation: 3,
        preemptedGeneration: 2,
        triggerKind: "owner_message",
        triggerRef: "event-bclp-release-child",
        occupantId: "owner",
        nowMs: 3,
      });
      putInFlight(db, {
        effectId: "effect-bclp-released",
        cycleId: predecessor.cycleId,
        generation: 1,
        correlationId: "corr-bclp-released",
        idempotencyKey: "idem-bclp-released",
        originEventId: "event-bclp-release-parent",
        operationKind: "workspace.verify",
      });
      putInFlight(db, {
        effectId: "effect-bclp-retained",
        cycleId: "cycle-bclp-release-middle",
        generation: 2,
        correlationId: "corr-bclp-retained",
        idempotencyKey: "idem-bclp-retained",
        originEventId: "event-bclp-release-middle",
        operationKind: "workspace.verify",
      });
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run("settlement-bclp-release", "cycle-bclp-release-child", 3, JSON.stringify({
        operations: { effectsCompleted: ["effect-bclp-released"] },
      }));

      expect(listInFlightForThoughtCycle(db, "cycle-bclp-release-child").map((row) => row.effectId).sort()).toEqual([
        "effect-bclp-retained",
      ]);
    } finally {
      db.close();
    }
  });
});

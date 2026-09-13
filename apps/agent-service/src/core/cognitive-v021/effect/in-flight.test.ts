import { describe, expect, it } from "vitest";
import { getEffectReceipt, getInFlight, markInFlightUnknown, putInFlight, recordEffectReceipt } from "./in-flight.js";
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
});

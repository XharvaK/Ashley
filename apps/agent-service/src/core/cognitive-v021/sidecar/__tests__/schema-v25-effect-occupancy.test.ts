import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import { putInFlight, recordEffectReceipt } from "../../effect/in-flight.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

function prepareV24(db: ReturnType<typeof openTestSidecar>): void {
  db.exec(`
    UPDATE in_flight_effects SET state = 'receipted';
    PRAGMA user_version = 24;
    UPDATE cognitive_sidecar_meta SET schema_version = 24 WHERE id = 1;
  `);
}

describe("cognitive sidecar Schema V25 effect occupancy", () => {
  it("preserves rows and receipts, releasing only conclusively resolved wake slots", () => {
    const db = openTestSidecar();
    try {
      const resolvedCycle = admitTestCycle(db, {
        cycleId: "cycle-v25-resolved",
        conversationId: "thread-v25-resolved",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-v25-resolved",
        occupantId: "doc",
        nowMs: 1,
      });
      const unresolvedCycle = admitTestCycle(db, {
        cycleId: "cycle-v25-unresolved",
        conversationId: "thread-v25-unresolved",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-v25-unresolved",
        occupantId: "doc",
        nowMs: 2,
      });
      const ambiguousCycle = admitTestCycle(db, {
        cycleId: "cycle-v25-ambiguous",
        conversationId: "thread-v25-ambiguous",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-v25-ambiguous",
        occupantId: "doc",
        nowMs: 3,
      });

      const resolved = putInFlight(db, {
        effectId: "effect-v25-resolved",
        cycleId: resolvedCycle.cycleId,
        generation: 1,
        wakeId: resolvedCycle.wakeId,
        correlationId: "corr-v25-resolved",
        idempotencyKey: "idem-v25-resolved",
        originEventId: "event-v25-resolved",
        dispatchedAtMs: 10,
      });
      recordEffectReceipt(db, {
        receiptId: "receipt-v25-resolved",
        effectId: resolved.effectId,
        idempotencyKey: resolved.idempotencyKey,
        outcome: "succeeded",
        claims: { executionTruth: "effect_verified" },
        atMs: 11,
        dataClassification: "never_public",
        secretOmitted: true,
      });

      const unresolved = putInFlight(db, {
        effectId: "effect-v25-unresolved",
        cycleId: unresolvedCycle.cycleId,
        generation: 1,
        wakeId: unresolvedCycle.wakeId,
        correlationId: "corr-v25-unresolved",
        idempotencyKey: "idem-v25-unresolved",
        originEventId: "event-v25-unresolved",
        dispatchedAtMs: 12,
      });
      recordEffectReceipt(db, {
        receiptId: "receipt-v25-unresolved",
        effectId: unresolved.effectId,
        idempotencyKey: unresolved.idempotencyKey,
        outcome: "outcome_unknown",
        claims: {},
        atMs: 13,
        dataClassification: "never_public",
        secretOmitted: true,
      });

      const ambiguous = putInFlight(db, {
        effectId: "effect-v25-ambiguous",
        cycleId: ambiguousCycle.cycleId,
        generation: 1,
        wakeId: ambiguousCycle.wakeId,
        correlationId: "corr-v25-ambiguous",
        idempotencyKey: "idem-v25-ambiguous",
        originEventId: "event-v25-ambiguous",
        dispatchedAtMs: 14,
      });
      db.prepare("UPDATE in_flight_effects SET state = 'receipted' WHERE effect_id = ?")
        .run(ambiguous.effectId);

      prepareV24(db);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(25);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 25 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM in_flight_effects").get()).toMatchObject({ count: 3 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM effect_receipts").get()).toMatchObject({ count: 2 });
      expect(db.prepare("SELECT state FROM in_flight_effects WHERE effect_id = ?").get(resolved.effectId))
        .toMatchObject({ state: "receipted" });
      expect(db.prepare("SELECT state FROM in_flight_effects WHERE effect_id = ?").get(unresolved.effectId))
        .toMatchObject({ state: "unknown" });
      expect(db.prepare("SELECT state FROM in_flight_effects WHERE effect_id = ?").get(ambiguous.effectId))
        .toMatchObject({ state: "unknown" });

      expect(() => putInFlight(db, {
        effectId: "effect-v25-resolved-next",
        cycleId: resolvedCycle.cycleId,
        generation: 1,
        wakeId: resolvedCycle.wakeId,
        correlationId: "corr-v25-resolved-next",
        idempotencyKey: "idem-v25-resolved-next",
        originEventId: "event-v25-resolved",
        dispatchedAtMs: 15,
      })).not.toThrow();
      expect(() => putInFlight(db, {
        effectId: "effect-v25-unresolved-next",
        cycleId: unresolvedCycle.cycleId,
        generation: 1,
        wakeId: unresolvedCycle.wakeId,
        correlationId: "corr-v25-unresolved-next",
        idempotencyKey: "idem-v25-unresolved-next",
        originEventId: "event-v25-unresolved",
        dispatchedAtMs: 16,
      })).toThrow();
      expect(() => putInFlight(db, {
        effectId: "effect-v25-ambiguous-next",
        cycleId: ambiguousCycle.cycleId,
        generation: 1,
        wakeId: ambiguousCycle.wakeId,
        correlationId: "corr-v25-ambiguous-next",
        idempotencyKey: "idem-v25-ambiguous-next",
        originEventId: "event-v25-ambiguous",
        dispatchedAtMs: 17,
      })).toThrow();
    } finally {
      db.close();
    }
  });
});

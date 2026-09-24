import { describe, expect, it, vi } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  getEffectReceipt,
  getInFlight,
  getInFlightByEffectId,
  getInFlightByIdempotencyKey,
  putInFlight,
} from "./in-flight.js";
import { createEffectProposal, dispatchEffect } from "./proposal.js";
import { EffectOwnershipLostError } from "./execution-control.js";

describe("v0.2.1 effect proposal", () => {
  it("stores an effectful proposal and rechecks the epoch before execution", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "c1", occupantId: "doc", nowMs: 1 });
      const proposal = createEffectProposal({ cycleId: "c1", generation: 1, authorityEpoch: 1, kind: "workspace.write_file", request: { path: "x" }, originEventId: "event-1" });
      let executed = 0;
      const blocked = await dispatchEffect(db, proposal, { authorityEpoch: 2 }, async () => { executed++; return { ok: true }; });
      expect(blocked).toMatchObject({ dispatched: false, codes: ["DISPATCH_EPOCH_CHANGED"] });
      expect(executed).toBe(0);
    } finally { db.close(); }
  });

  it("does not execute the same idempotency key twice", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "idem-replay", occupantId: "doc", nowMs: 1 });
      const first = createEffectProposal({ cycleId: "c1", generation: 1, authorityEpoch: 1, idempotencyKey: "idem-replay", kind: "workspace.read_file", request: { path: "x" }, originEventId: "idem-replay" });
      const second = createEffectProposal({ cycleId: "c1", generation: 1, authorityEpoch: 1, idempotencyKey: "idem-replay", kind: "workspace.read_file", request: { path: "x" }, originEventId: "idem-replay" });
      let executed = 0;
      const execute = async () => { executed += 1; return { ok: true }; };
      const firstResult = await dispatchEffect(db, first, { authorityEpoch: 1, generation: 1 }, execute);
      const secondResult = await dispatchEffect(db, second, { authorityEpoch: 1, generation: 1 }, execute);
      expect(firstResult).toMatchObject({ dispatched: true, replayed: false });
      expect(secondResult).toMatchObject({ dispatched: true, replayed: true });
      expect(executed).toBe(1);
      expect(getEffectReceipt(db, first.effectId)).toMatchObject({ outcome: "succeeded", idempotencyKey: "idem-replay" });
      expect(getInFlight(db, first.effectId)).toMatchObject({ status: "receipted" });
    } finally {
      db.close();
    }
  });

  it("resolves effect IDs and idempotency keys independently when their strings collide", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-key-collision-a", conversationId: "thread-a", generation: 1, triggerKind: "owner_message", triggerRef: "event-a", occupantId: "doc", nowMs: 1 });
      admitTestCycle(db, { cycleId: "c-key-collision-b", conversationId: "thread-b", generation: 1, triggerKind: "owner_message", triggerRef: "event-b", occupantId: "doc", nowMs: 2 });
      const effectIdMatch = putInFlight(db, {
        effectId: "same-namespace-value",
        cycleId: "c-key-collision-a",
        generation: 1,
        correlationId: "corr-a",
        idempotencyKey: "idem-a",
        originEventId: "event-a",
      });
      const idempotencyMatch = putInFlight(db, {
        effectId: "effect-b",
        cycleId: "c-key-collision-b",
        generation: 1,
        correlationId: "corr-b",
        idempotencyKey: "same-namespace-value",
        originEventId: "event-b",
      });

      expect(getInFlightByEffectId(db, "same-namespace-value")?.effectId).toBe(effectIdMatch.effectId);
      expect(getInFlightByIdempotencyKey(db, "same-namespace-value")?.effectId).toBe(idempotencyMatch.effectId);
      expect(putInFlight(db, {
        effectId: "ignored-replay-id",
        cycleId: "c-key-collision-b",
        generation: 1,
        correlationId: "corr-replay",
        idempotencyKey: "same-namespace-value",
        originEventId: "event-b",
      }).effectId).toBe(idempotencyMatch.effectId);
    } finally {
      db.close();
    }
  });

  it("turns a distinct effect blocked by same-wake occupancy into a dispatch refusal", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-wake-occupied", conversationId: "thread-occupied", generation: 1, triggerKind: "owner_message", triggerRef: "event-occupied", occupantId: "doc", nowMs: 1 });
      putInFlight(db, {
        effectId: "effect-occupant",
        cycleId: "c-wake-occupied",
        generation: 1,
        correlationId: "corr-occupant",
        idempotencyKey: "idem-occupant",
        originEventId: "event-occupied",
      });
      const second = createEffectProposal({
        cycleId: "c-wake-occupied",
        generation: 1,
        authorityEpoch: 1,
        idempotencyKey: "idem-distinct",
        kind: "workspace.verify",
        request: { path: "src" },
        originEventId: "event-occupied",
      });
      const execute = vi.fn(async () => ({ outcome: "succeeded" as const }));

      const result = await dispatchEffect(db, second, { authorityEpoch: 1, generation: 1 }, execute);

      expect(result).toMatchObject({ dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" });
      expect(execute).not.toHaveBeenCalled();
      expect(db.prepare("SELECT COUNT(*) AS count FROM in_flight_effects WHERE wake_id = (SELECT wake_id FROM cycle_records WHERE cycle_id = ?)")
        .get("c-wake-occupied")).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("allows only one of two competing distinct effects to acquire the same wake", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-wake-race", conversationId: "thread-wake-race", generation: 1, triggerKind: "owner_message", triggerRef: "event-wake-race", occupantId: "doc", nowMs: 1 });
      const firstProposal = createEffectProposal({
        cycleId: "c-wake-race",
        generation: 1,
        authorityEpoch: 1,
        idempotencyKey: "idem-wake-race-a",
        kind: "workspace.write_file",
        request: { path: "a.ts" },
        originEventId: "event-wake-race",
      });
      const secondProposal = createEffectProposal({
        cycleId: "c-wake-race",
        generation: 1,
        authorityEpoch: 1,
        idempotencyKey: "idem-wake-race-b",
        kind: "workspace.write_file",
        request: { path: "b.ts" },
        originEventId: "event-wake-race",
      });
      let resolveFirst!: (value: unknown) => void;
      const firstExecution = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
      const executeFirst = vi.fn(() => firstExecution);
      const executeSecond = vi.fn(async () => ({ outcome: "succeeded" }));

      const first = dispatchEffect(db, firstProposal, { authorityEpoch: 1, generation: 1 }, executeFirst);
      const second = await dispatchEffect(db, secondProposal, { authorityEpoch: 1, generation: 1 }, executeSecond);

      expect(second).toMatchObject({ dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" });
      expect(executeFirst).toHaveBeenCalledTimes(1);
      expect(executeSecond).not.toHaveBeenCalled();
      expect(db.prepare("SELECT COUNT(*) AS count FROM in_flight_effects WHERE wake_id = (SELECT wake_id FROM cycle_records WHERE cycle_id = ?)")
        .get("c-wake-race")).toMatchObject({ count: 1 });

      resolveFirst({ outcome: "succeeded" });
      await expect(first).resolves.toMatchObject({ dispatched: true, receipt: { outcome: "succeeded" } });
    } finally {
      db.close();
    }
  });

  it("rechecks the authority epoch after admission and never executes after an epoch change", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-epoch", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "c-epoch", occupantId: "doc", nowMs: 1 });
      const proposal = createEffectProposal({ cycleId: "c-epoch", generation: 1, authorityEpoch: 1, kind: "workspace.write_file", request: {}, originEventId: "c-epoch" });
      let reloads = 0;
      let executed = 0;
      const result = await dispatchEffect(db, proposal, {
        authorityEpoch: 1,
        generation: 1,
        reload: () => ({ authorityEpoch: reloads++ === 0 ? 1 : 2, generation: 1 }),
      }, async () => { executed += 1; return { outcome: "succeeded" }; });
      expect(result).toMatchObject({ dispatched: false, codes: ["DISPATCH_EPOCH_CHANGED"] });
      expect(executed).toBe(0);
      expect(getInFlight(db, proposal.effectId)).toMatchObject({ status: "unknown" });
    } finally { db.close(); }
  });

  it("rechecks the active generation after admission and refuses stale execution", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-generation", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "c-generation", occupantId: "doc", nowMs: 1 });
      const proposal = createEffectProposal({ cycleId: "c-generation", generation: 1, authorityEpoch: 1, kind: "workspace.write_file", request: {}, originEventId: "c-generation" });
      let reloads = 0;
      let executed = 0;
      const result = await dispatchEffect(db, proposal, {
        authorityEpoch: 1,
        generation: 1,
        reload: () => ({ authorityEpoch: 1, generation: reloads++ === 0 ? 1 : 2 }),
      }, async () => { executed += 1; return { outcome: "succeeded" }; });
      expect(result).toMatchObject({ dispatched: false, codes: ["STALE_GENERATION"] });
      expect(executed).toBe(0);
      expect(getInFlight(db, proposal.effectId)).toMatchObject({ status: "unknown" });
    } finally { db.close(); }
  });

  it("keeps a possibly dispatched effect unresolved when execution ownership is lost", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-fenced-effect", conversationId: "thread-fenced", generation: 1, triggerKind: "owner_message", triggerRef: "event-fenced", occupantId: "doc", nowMs: 1 });
      const proposal = createEffectProposal({
        cycleId: "c-fenced-effect",
        generation: 1,
        authorityEpoch: 1,
        idempotencyKey: "idem-fenced-effect",
        kind: "workspace.write_file",
        request: { path: "x" },
        originEventId: "event-fenced",
      });

      const result = await dispatchEffect(db, proposal, { authorityEpoch: 1, generation: 1 }, async () => {
        throw new EffectOwnershipLostError();
      });

      expect(result).toMatchObject({ dispatched: false, origin: "fenced", codes: ["effect_ownership_lost"] });
      expect(getInFlight(db, proposal.effectId)).toMatchObject({ status: "unknown" });
      expect(getEffectReceipt(db, proposal.effectId)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("fails closed when exact originEventId is missing or empty", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-missing-origin", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "c-missing-origin", occupantId: "doc", nowMs: 1 });
      const proposal = createEffectProposal({ cycleId: "c-missing-origin", generation: 1, authorityEpoch: 1, kind: "workspace.write_file", request: {} });
      await expect(dispatchEffect(db, proposal, { authorityEpoch: 1, generation: 1 }, async () => ({ ok: true }))).rejects.toThrow("origin_event_id_required");
    } finally { db.close(); }
  });

  it("binds exact originEventId and originAttemptId into in_flight_effects without swapping across events", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-exact-1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "event-A", occupantId: "doc", nowMs: 1 });
      admitTestCycle(db, { cycleId: "c-exact-2", conversationId: "thread-1", generation: 2, triggerKind: "owner_message", triggerRef: "event-B", occupantId: "doc", nowMs: 2 });
      db.prepare("INSERT INTO durable_work_attempts (attempt_id, event_id, ordinal, worker_id, started_at_ms, dispatch_truth) VALUES ('attempt-1', 'event-A', 1, 'worker-1', 1, 'not_started')").run();

      const prop1 = createEffectProposal({ cycleId: "c-exact-1", generation: 1, authorityEpoch: 1, kind: "workspace.write_file", request: {}, originEventId: "event-A", originAttemptId: "attempt-1" });
      const prop2 = createEffectProposal({ cycleId: "c-exact-2", generation: 2, authorityEpoch: 1, kind: "workspace.write_file", request: {}, originEventId: "event-B", originAttemptId: null });
      await dispatchEffect(db, prop1, { authorityEpoch: 1, generation: 1 }, async () => ({ ok: true }));
      await dispatchEffect(db, prop2, { authorityEpoch: 1, generation: 2 }, async () => ({ ok: true }));

      const record1 = getInFlight(db, prop1.effectId);
      const record2 = getInFlight(db, prop2.effectId);
      expect(record1).toMatchObject({ originEventId: "event-A", originAttemptId: "attempt-1" });
      expect(record2).toMatchObject({ originEventId: "event-B", originAttemptId: null });
      expect(record1?.originEventId).not.toBe(record2?.originEventId);
    } finally { db.close(); }
  });

  it("labels false dispatch results with authority or dispatch origin", async () => {
    // Provenance for terminal classification: an Authority verdict rejects
    // with origin "authority", while dispatch-mechanics refusal (occupied
    // idempotency key) carries origin "dispatch" even though its code
    // IN_FLIGHT_UNKNOWN is also a genuine AuthorityCode elsewhere.
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "c-origin", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "c-origin", occupantId: "doc", nowMs: 1 });
      const epochMismatch = createEffectProposal({ cycleId: "c-origin", generation: 1, authorityEpoch: 1, kind: "workspace.read_file", request: { path: "x" }, originEventId: "c-origin" });
      const authorityResult = await dispatchEffect(db, epochMismatch, { authorityEpoch: 2 }, async () => ({ ok: true }));
      expect(authorityResult).toMatchObject({ dispatched: false, codes: ["DISPATCH_EPOCH_CHANGED"], origin: "authority" });
      const occupant = createEffectProposal({ cycleId: "c-origin", generation: 1, authorityEpoch: 1, idempotencyKey: "idem-origin", kind: "workspace.read_file", request: { path: "x" }, originEventId: "c-origin" });
      putInFlight(db, { effectId: "effect-occupant", cycleId: "c-origin", generation: 1, correlationId: "corr-origin", idempotencyKey: "idem-origin", payload: {}, originEventId: "c-origin", originAttemptId: null });
      const dispatchResult = await dispatchEffect(db, occupant, { authorityEpoch: 1, generation: 1 }, async () => ({ ok: true }));
      expect(dispatchResult).toMatchObject({ dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" });
    } finally { db.close(); }
  });
});

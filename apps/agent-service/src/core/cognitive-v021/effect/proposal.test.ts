import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { getInFlight, getEffectReceipt, putInFlight } from "./in-flight.js";
import { createEffectProposal, dispatchEffect } from "./proposal.js";

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

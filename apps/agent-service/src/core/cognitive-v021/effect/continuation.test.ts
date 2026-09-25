import { describe, expect, it } from "vitest";
import { claimConversationCognition, readConversationCognition } from "../cycle/cognition-claim.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { putInFlight } from "./in-flight.js";
import {
  acceptEffectContinuation,
  finishEffectContinuation,
  getEffectContinuation,
  renewEffectContinuationLease,
} from "./continuation.js";

const BASE = 1_800_000_000_000;

describe("develop effect continuation ownership", () => {
  it("releases Thought only after durable effect admission and preserves its deadline and remaining rounds", () => {
    const db = openTestSidecar();
    const cycle = admitTestCycle(db, {
      cycleId: "cycle-continuation-transfer",
      conversationId: "conversation-continuation-transfer",
      triggerKind: "owner_message",
      triggerRef: "event-continuation-transfer",
      nowMs: BASE,
    });
    try {
      const wakeId = cycle.wakeId;
      if (!wakeId) throw new Error("wake_missing");
      const claim = claimConversationCognition(db, {
        conversationId: cycle.conversationId,
        eventId: "event-continuation-transfer",
        wakeId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        nowMs: BASE,
      });
      if (!claim.ok) throw new Error("cognition_claim_missing");
      const proposal = {
        effectId: "effect-continuation-transfer",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        idempotencyKey: "idem-continuation-transfer",
        kind: "candidate.develop",
        purpose: "apply the bounded candidate change",
        request: {
          projectId: "project-1",
          workspaceId: "workspace-1",
          audienceScope: { kind: "owner_private" },
        },
        authorityEpoch: 1,
      };
      putInFlight(db, {
        effectId: proposal.effectId,
        cycleId: proposal.cycleId,
        generation: proposal.generation,
        wakeId,
        correlationId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        payload: proposal.request,
        operationKind: proposal.kind,
        originEventId: "event-continuation-transfer",
      });

      const accepted = acceptEffectContinuation(db, {
        proposal,
        conversationId: cycle.conversationId,
        deadlineAtMs: BASE + 6 * 60 * 60_000,
        remainingEffectRounds: 3,
        cognitionClaimToken: claim.claimToken,
        runtimeId: "runtime-test",
        nowMs: BASE + 100,
      });

      expect(readConversationCognition(db, cycle.conversationId)).toBeNull();
      expect(accepted.continuation).toMatchObject({
        effectId: proposal.effectId,
        state: "running",
        deadlineAtMs: BASE + 6 * 60 * 60_000,
        remainingEffectRounds: 3,
        purpose: "apply the bounded candidate change",
        target: { projectId: "project-1", workspaceId: "workspace-1" },
      });
      expect(db.prepare("SELECT state FROM in_flight_effects WHERE effect_id = ?").get(proposal.effectId))
        .toMatchObject({ state: "in_flight" });
      expect(db.prepare("SELECT diagnostic_json FROM effect_diagnostics WHERE effect_id = ?").get(proposal.effectId))
        .toMatchObject({ diagnostic_json: expect.stringContaining("remainingEffectRounds") });

      expect(renewEffectContinuationLease(db, {
        effectId: proposal.effectId,
        leaseToken: accepted.continuation.leaseToken,
        nowMs: BASE + 30_000,
      })).toBe(true);
      expect(getEffectContinuation(db, proposal.effectId)?.deadlineAtMs)
        .toBe(BASE + 6 * 60 * 60_000);
      expect(getEffectContinuation(db, proposal.effectId)?.remainingEffectRounds).toBe(3);

      expect(finishEffectContinuation(db, {
        effectId: proposal.effectId,
        leaseToken: accepted.continuation.leaseToken,
        state: "succeeded",
        terminalClass: "SUCCESS",
        effectTruth: "effect_verified",
        nowMs: BASE + 40_000,
      })).toBe(true);
      expect(getEffectContinuation(db, proposal.effectId)).toMatchObject({
        state: "succeeded",
        deadlineAtMs: BASE + 6 * 60 * 60_000,
        remainingEffectRounds: 3,
      });
    } finally {
      db.close();
    }
  });

  it("refuses release when no exact live cognition claim owns the admitted effect", () => {
    const db = openTestSidecar();
    const cycle = admitTestCycle(db, {
      cycleId: "cycle-continuation-no-claim",
      conversationId: "conversation-continuation-no-claim",
      triggerKind: "owner_message",
      triggerRef: "event-continuation-no-claim",
      nowMs: BASE,
    });
    try {
      const wakeId = cycle.wakeId;
      if (!wakeId) throw new Error("wake_missing");
      const proposal = {
        effectId: "effect-continuation-no-claim",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        idempotencyKey: "idem-continuation-no-claim",
        kind: "candidate.develop",
        purpose: "bounded development",
        request: { audienceScope: { kind: "owner_private" } },
        authorityEpoch: 1,
      };
      putInFlight(db, {
        effectId: proposal.effectId,
        cycleId: proposal.cycleId,
        generation: proposal.generation,
        wakeId,
        correlationId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        payload: proposal.request,
        operationKind: proposal.kind,
        originEventId: "event-continuation-no-claim",
      });

      expect(() => acceptEffectContinuation(db, {
        proposal,
        conversationId: cycle.conversationId,
        deadlineAtMs: BASE + 60_000,
        remainingEffectRounds: 3,
        cognitionClaimToken: "wrong-token",
        runtimeId: "runtime-test",
        nowMs: BASE + 1,
      })).toThrow("effect_continuation_cognition_claim_lost");
      expect(getEffectContinuation(db, proposal.effectId)).toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS count FROM cognition_claims WHERE conversation_id = ?")
        .get(cycle.conversationId)).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});

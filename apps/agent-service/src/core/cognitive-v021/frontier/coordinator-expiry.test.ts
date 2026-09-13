import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { openNuclearDb } from "../../db.js";
import { admitCognitiveIngress } from "../ingress/http.js";
import { consumeNextInboxEvent } from "../cycle/inbox-consumer.js";
import { getCycle, getInboxEvent } from "../cycle/inbox.js";
import { getWake } from "../wake/ledger.js";
import {
  getActiveDeferredFrontier,
  getDeferredFrontier,
} from "./ledger.js";
import { startFrontierCoordinator } from "./coordinator.js";
import { createLiveCognitiveDispatcher } from "../dispatch/live.js";
import type {
  CapabilityReality,
  IdentitySlice,
  KernelDeps,
  Observation,
} from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function createNuclearDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function createSidecarDb(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
    dataPlane: { kind: "isolated" },
  });
}

function mockDeps(nowRef: { nowMs: number }, completeChatImpl: any): KernelDeps {
  return {
    nowMs: () => nowRef.nowMs,
    attentionDb: openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } }),
    completeChat: vi.fn(completeChatImpl),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: false },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
  };
}

describe("Campaign-1 exhaustion terminalization (capacity deadline expiry)", () => {
  it("terminalizes frontier=exhausted, cycle=silent, wake=terminal/expired on capacity_wait_max_duration_exceeded", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    const completeChatMock = async () => {
      const err = Object.assign(new Error("attention_deadline"), {
        code: "attention_deadline",
        nextEligibleAtMs: clock.nowMs + 30_000,
      });
      throw err;
    };
    const deps = mockDeps(clock, completeChatMock);

    // Leader A defers to frontier.
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Leader message A" },
      { nowMs: clock.nowMs },
    );
    expect(ingressA.accepted).toBe(true);

    await consumeNextInboxEvent(sidecar, {
      workerId: "worker:test",
      handler: createLiveCognitiveDispatcher({ sidecar, nuclear, deps }),
      nowMs: () => clock.nowMs,
    });

    const leaderSettled = getInboxEvent(sidecar, ingressA.inboxEventId);
    expect(leaderSettled?.terminalReason).toBe("deferred_to_frontier");

    // Followers B and C are coalesced while waiting.
    clock.nowMs = 1_005_000;
    const ingressB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Follower message B" },
      { nowMs: clock.nowMs },
    );
    clock.nowMs = 1_010_000;
    const ingressC = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Follower message C" },
      { nowMs: clock.nowMs },
    );
    expect(getInboxEvent(sidecar, ingressB.inboxEventId)?.terminalReason).toBe("subsumed_by_frontier");
    expect(getInboxEvent(sidecar, ingressC.inboxEventId)?.terminalReason).toBe("subsumed_by_frontier");

    const frontierBefore = getActiveDeferredFrontier(sidecar, ingressA.conversationId);
    expect(frontierBefore?.state).toBe("waiting");

    // Drive past the absolute 120s bound: nextEligibleAtMs > capacityDeadlineAtMs.
    clock.nowMs = 1_121_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    const processed = await coordinator.pollNow();
    coordinator.stop();
    expect(processed).toBe(1);

    const frontier = getDeferredFrontier(sidecar, frontierBefore!.frontierId);
    expect(frontier?.state).toBe("exhausted");
    expect(frontier?.terminalReason).toBe("capacity_wait_max_duration_exceeded");
    expect(sidecar.prepare("SELECT failure_class, obligation_frontier_id FROM c3_terminal_experiences").get()).toMatchObject({
      failure_class: "capacity_wait_max_duration_exceeded",
      obligation_frontier_id: frontierBefore!.frontierId,
    });
    expect(getActiveDeferredFrontier(sidecar, ingressA.conversationId)).toBeNull();

    const cycle = getCycle(sidecar, ingressA.cycleId);
    expect(cycle?.state).toBe("silent");

    const wake = cycle?.wakeId ? getWake(sidecar, cycle.wakeId) : null;
    expect(wake?.state).toBe("terminal");
    expect(wake?.terminalReason).toBe("expired");

    // Leader/follower durable dispositions are preserved.
    expect(getInboxEvent(sidecar, ingressA.inboxEventId)?.terminalReason).toBe("deferred_to_frontier");
    expect(getInboxEvent(sidecar, ingressB.inboxEventId)?.terminalReason).toBe("subsumed_by_frontier");
    expect(getInboxEvent(sidecar, ingressC.inboxEventId)?.terminalReason).toBe("subsumed_by_frontier");

    // No publication side effects.
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });

    // Second coordinator poll cannot reclaim the exhausted frontier.
    const coordinator2 = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    const processed2 = await coordinator2.pollNow();
    coordinator2.stop();
    expect(processed2).toBe(0);
    expect(getDeferredFrontier(sidecar, frontierBefore!.frontierId)?.state).toBe("exhausted");

    sidecar.close();
    nuclear.close();
  });

  it("does not invent expired for non-forward exhaustion", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    // First defer normally, then return a non-forward hint at T1.
    let calls = 0;
    const completeChatMock = async () => {
      calls += 1;
      if (calls === 1) {
        const err = Object.assign(new Error("attention_deadline"), {
          code: "attention_deadline",
          nextEligibleAtMs: clock.nowMs + 30_000,
        });
        throw err;
      }
      const err = Object.assign(new Error("attention_deadline"), {
        code: "attention_deadline",
        nextEligibleAtMs: clock.nowMs,
      });
      throw err;
    };
    const deps = mockDeps(clock, completeChatMock);

    const ingress = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Non-forward probe" },
      { nowMs: clock.nowMs },
    );
    await consumeNextInboxEvent(sidecar, {
      workerId: "worker:test",
      handler: createLiveCognitiveDispatcher({ sidecar, nuclear, deps }),
      nowMs: () => clock.nowMs,
    });

    const frontierBefore = getActiveDeferredFrontier(sidecar, ingress.conversationId);
    expect(frontierBefore?.state).toBe("waiting");

    clock.nowMs = 1_030_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    await coordinator.pollNow();
    coordinator.stop();

    const frontier = getDeferredFrontier(sidecar, frontierBefore!.frontierId);
    expect(frontier?.state).toBe("exhausted");
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toMatchObject({ count: 0 });
    const cycle = getCycle(sidecar, ingress.cycleId);
    expect(cycle?.state).toBe("silent");
    const wake = cycle?.wakeId ? getWake(sidecar, cycle.wakeId) : null;
    // Non-forward exhaustion must not invent deadline expiry.
    expect(wake?.terminalReason === "expired").toBe(false);

    sidecar.close();
    nuclear.close();
  });
});

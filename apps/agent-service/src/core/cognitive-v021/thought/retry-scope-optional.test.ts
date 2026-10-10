import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeSemanticSettlement, admitTestCycle, openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { runCognitiveCycle } from "./run.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { env } from "../../../env.js";


const originalOwnerId = env.discordOwnerId;
beforeAll(() => {
  env.discordOwnerId = "doc";
});
afterAll(() => {
  env.discordOwnerId = originalOwnerId;
});

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
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: true },
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
    ...overrides,
  };
}

/** Attempt 1 fails on a required part (interactionIntent), so a structural retry is scheduled. */
function firstAttempt() {
  return { ...makeSemanticSettlement({ journal: { activity: "think", entry: "first entry" } }), interactionIntent: "bogus" };
}

/** The retry repairs interactionIntent (its allowed path) and also rewrites the optional journal entry. */
function retryAttempt() {
  return { ...makeSemanticSettlement({ journal: { activity: "think", entry: "rewritten entry" } }), interactionIntent: "continue" };
}

describe("corrective retry scope: an out-of-scope optional change is dropped, not refused", () => {
  it("accepts the retry with the optional part dropped and publishes on attempt 2", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-retry-scope",
        conversationId: "thread-retry-scope",
        triggerKind: "owner_message",
        triggerRef: "owner-retry-scope",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-retry-scope",
        text: "say hello",
        discordMessageIds: ["retry-scope-1"],
        nowMs: 2,
      });
      const event = appendInboxEvent(sidecar, {
        wakeId: cycle.wakeId,
        conversationId: "thread-retry-scope",
        kind: "owner_message",
        payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
        createdAtMs: 2,
      });
      let calls = 0;
      const completeChat = vi.fn(async () => {
        calls += 1;
        return {
          text: JSON.stringify(calls === 1 ? firstAttempt() : retryAttempt()),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(calls).toBe(2);
      expect(result.published).toBe(true);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});

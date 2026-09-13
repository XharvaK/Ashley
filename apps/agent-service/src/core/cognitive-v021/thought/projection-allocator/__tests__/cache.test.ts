import { describe, it, expect, vi } from "vitest";
import {
  semanticPassKey,
  hashAuthorityObjections,
  hashThoughtSourceCurrentness,
  ProjectionCache,
} from "../cache.js";
import { appendInboxEvent } from "../../../cycle/inbox.js";
import { appendOwnerUtterance } from "../../../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../../../test-support.js";
import { runCognitiveCycle } from "../../run.js";
import * as discoverModule from "../../../retrieval/discover.js";
import * as allocatorModule from "../allocator.js";

describe("Projection Cache & Semantic Pass Keys", () => {
  it("produces identical key for identical semantic pass state across structural retries", () => {
    const key1 = semanticPassKey({
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      observationsCount: 2,
      inFlightCount: 0,
      authorityObjectionsHash: hashAuthorityObjections([]),
      composeLogIds: ["log-1", "log-2"],
      rememberDirectivePresent: false,
    });

    const key2 = semanticPassKey({
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      observationsCount: 2,
      inFlightCount: 0,
      authorityObjectionsHash: hashAuthorityObjections([]),
      composeLogIds: ["log-2", "log-1"], // Order permutation produces same key
      rememberDirectivePresent: false,
    });

    expect(key1).toBe(key2);
  });

  it("invalidates cache key when semantic evidence changes", () => {
    const base = {
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      observationsCount: 0,
      inFlightCount: 0,
      authorityObjectionsHash: "none",
      composeLogIds: ["log-1"],
      rememberDirectivePresent: false,
    };

    const keyBase = semanticPassKey(base);
    const keyNewObs = semanticPassKey({ ...base, observationsCount: 1 });
    const keyNewGen = semanticPassKey({ ...base, generation: 2 });
    const keyNewDirective = semanticPassKey({ ...base, rememberDirectivePresent: true });

    expect(keyNewObs).not.toBe(keyBase);
    expect(keyNewGen).not.toBe(keyBase);
    expect(keyNewDirective).not.toBe(keyBase);
  });

  it("invalidates a structural retry key when host-captured source currentness changes", () => {
    const base = {
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      observationsCount: 0,
      inFlightCount: 0,
      authorityObjectionsHash: "none",
      composeLogIds: ["log-1"],
      rememberDirectivePresent: false,
    };
    const first = hashThoughtSourceCurrentness({
      workingContext: {},
      learnedSelfRevisionHead: "self-a",
      relationshipOwnerId: "doc",
      relationshipRevisionHead: "relationship-a",
    });
    const second = hashThoughtSourceCurrentness({
      workingContext: {},
      learnedSelfRevisionHead: "self-b",
      relationshipOwnerId: "doc",
      relationshipRevisionHead: "relationship-a",
    });

    expect(semanticPassKey({ ...base, sourceCurrentnessKey: first }))
      .not.toBe(semanticPassKey({ ...base, sourceCurrentnessKey: second }));
  });

  it("manages cache store entries correctly", () => {
    const cache = new ProjectionCache<{ hash: string }>();
    cache.set("k1", { hash: "hash1" });

    expect(cache.has("k1")).toBe(true);
    expect(cache.get("k1")?.hash).toBe("hash1");
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has("k1")).toBe(false);
  });

  it("proves structural retry reuses cached projection without rerunning retrieval or allocator (RETRIEVAL=1, ALLOCATOR=1, PROVIDER=2)", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();

    const retrieveSpy = vi.spyOn(discoverModule, "retrieveCandidates");
    const allocateSpy = vi.spyOn(allocatorModule, "allocateThoughtProjection");

    retrieveSpy.mockClear();
    allocateSpy.mockClear();

    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-cache-test",
      conversationId: "thread-cache-test",
      triggerKind: "owner_message",
      triggerRef: "owner-ref-1",
      occupantId: "doc",
      nowMs: 1,
    });

    const utterance = appendOwnerUtterance(sidecar, {
      conversationId: "thread-cache-test",
      text: "hello ashley",
      discordMessageIds: ["msg-1"],
      nowMs: 2,
    });

    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-cache-test",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: utterance.rowId,
        ownerMessage: utterance.text,
      },
      createdAtMs: 2,
    });

    let dispatchCount = 0;
    const completeChat = vi.fn(async (_messages) => {
      dispatchCount++;
      if (dispatchCount === 1) {
        // Attempt 1: Malformed response (invalid JSON) triggering structural retry
        return {
          text: "{ malformed json",
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      }
      // Attempt 2: Valid settlement draft
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });

    const deps = {
      nowMs: () => 10,
      attentionDb,
      completeChat,
      runPerception: vi.fn(async () => []),
      executeObservation: vi.fn(),
      executeEffect: vi.fn(),
      checkAuthority: () => ({ ok: true as const }),
      loadAuthorityPacks: () => ({
        epistemic: { allowInferredWorldClaims: false },
        currentness: { requireObservationForLatest: true },
        receipt: { receiptsByEffectId: {} },
        capability: {
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
        },
        operational: { sandboxAvailable: false },
        relational: { withdrawalActive: false, neverMention: [] },
        stateEpoch: { authorityEpoch: 1 },
      }),
      expressionEnabled: false,
      projectOutbox: vi.fn(async () => undefined),
      constitution: { constitutional: ["truth first"], stableSelf: [] },
      capabilityReality: {
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
      },
    };

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);

      expect(result.published).toBe(true);
      expect(retrieveSpy).toHaveBeenCalledTimes(1); // RETRIEVAL_CALLS = 1
      expect(allocateSpy).toHaveBeenCalledTimes(1); // ALLOCATION_CALLS = 1
      expect(completeChat).toHaveBeenCalledTimes(2); // PROVIDER_ATTEMPTS = 2
    } finally {
      retrieveSpy.mockRestore();
      allocateSpy.mockRestore();
      sidecar.close();
      attentionDb.close();
    }
  });
});

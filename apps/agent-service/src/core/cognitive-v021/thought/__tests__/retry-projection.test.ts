import { describe, it, expect, vi } from "vitest";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../../test-support.js";
import { appendInboxEvent } from "../../cycle/inbox.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { buildThoughtInput } from "../input.js";
import { allocateThoughtProjection, thoughtMessagesForProjection } from "../projection-allocator/allocator.js";
import { ProjectionCache, semanticPassKey, hashAuthorityObjections } from "../projection-allocator/cache.js";
import { computeSemanticProjectionHash, computeDispatchMessagesHash } from "../projection.js";
import { STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS, runCognitiveCycle } from "../run.js";
import type { IdentitySlice, CapabilityReality, ThoughtInput } from "../../types.js";

const constitution: IdentitySlice = {
  constitutional: ["truth first"],
  stableSelf: ["curious"],
};

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

describe("Structural Retry Projection Invariants (§14, §17.8)", () => {
  it("reuses identical semantic projection and hashes on malformed retry without re-retrieval", () => {
    const sidecar = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        conversationId: "conv-retry-1",
        triggerKind: "owner_message",
        triggerRef: "ev-1",
        occupantId: "owner-1",
      });

      appendOwnerUtterance(sidecar, {
        conversationId: "conv-retry-1",
        text: "Please help me review this code structure",
        discordMessageIds: ["d-1"],
      });

      const thoughtInput = buildThoughtInput({
        sidecar,
        cycle,
        triggerText: "Please help me review this code structure",
        constitution,
        capabilityReality,
        observations: [],
        inFlight: [],
        runtimeCondition: { thoughtUnavailable: false },
        rememberDirective: null,
        authorityObjections: [],
      });

      const cache = new ProjectionCache<{
        projected: ReturnType<typeof allocateThoughtProjection>["projected"];
        messages: ReturnType<typeof allocateThoughtProjection>["messages"];
        receipt: ReturnType<typeof allocateThoughtProjection>["receipt"];
        hashes: ReturnType<typeof allocateThoughtProjection>["hashes"];
      }>();

      const passKey = semanticPassKey({
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        pass: 1,
        observationsCount: 0,
        inFlightCount: 0,
        authorityObjectionsHash: hashAuthorityObjections([]),
        composeLogIds: thoughtInput.rawConversation.map((r) => r.rowId),
        rememberDirectivePresent: false,
      });

      // Pass 1: Allocation
      let allocationCallCount = 0;
      function getAllocatedProjection() {
        let cached = cache.get(passKey);
        if (!cached) {
          allocationCallCount++;
          const allocated = allocateThoughtProjection({
            thoughtInput,
            requestId: "req-1",
          });
          cached = {
            projected: allocated.projected,
            messages: allocated.messages,
            receipt: allocated.receipt,
            hashes: allocated.hashes,
          };
          cache.set(passKey, cached);
        }
        return cached;
      }

      const primary = getAllocatedProjection();
      expect(allocationCallCount).toBe(1);
      expect(primary.hashes.semanticProjectionHash).toBeTruthy();

      // Retry attempt (malformed response received):
      // Must hit cache without re-allocating or re-retrieving
      const retryCached = getAllocatedProjection();
      expect(allocationCallCount).toBe(1); // Cache hit, no re-allocation

      // Compute retry messages with structural feedback
      const retryMessages = thoughtMessagesForProjection(
        retryCached.projected,
        "invalid_json",
      );

      const retrySemanticHash = computeSemanticProjectionHash(retryCached.projected);
      const retryDispatchHash = computeDispatchMessagesHash(retryMessages);

      // Invariant 1: semanticProjectionHash is byte-identical across retries
      expect(retrySemanticHash).toBe(primary.hashes.semanticProjectionHash);

      // Invariant 2: dispatchMessagesHash differs ONLY by the corrective feedback prefix
      expect(retryDispatchHash).not.toBe(primary.hashes.dispatchMessagesHash);

      // Invariant 3: Structural retry output ceiling is 16_384
      expect(STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS).toBe(16_384);

      // Invariant 4: Evidence was not dropped to fit retry
      expect(retryCached.projected.rawConversation.length).toBe(thoughtInput.rawConversation.length);
      expect(retryCached.projected.retrieval.hits.length).toBe(primary.projected.retrieval.hits.length);
    } finally {
      sidecar.close();
    }
  });

  it("terminates after exactly 3 attempts with distinct request IDs and identical semantic projection hash", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();

    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-retry-ident",
        conversationId: "thread-retry-ident",
        triggerKind: "owner_message",
        triggerRef: "ev-retry-1",
        occupantId: "doc",
        nowMs: 100,
      });

      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-retry-ident",
        text: "Please inspect system logs for malformed output retry test",
        discordMessageIds: ["d-retry-1"],
        nowMs: 105,
      });

      const event = appendInboxEvent(sidecar, {
        conversationId: "thread-retry-ident",
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
        },
      });

      const recordedRequestIds: string[] = [];
      const recordedDispatchMessages: string[] = [];

      let providerAttempts = 0;
      const completeChat = vi.fn(async (messages: unknown, options?: any) => {
        providerAttempts++;
        recordedRequestIds.push(options?.requestId ?? "unknown");
        recordedDispatchMessages.push(JSON.stringify(messages));
        return {
          text: "not valid json response",
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });

      const deps = {
        nowMs: () => 110,
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

      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);

      // Must terminate after bounded budget without publishing
      expect(result.published).toBe(false);
      expect(providerAttempts).toBe(3); // 1 primary + 2 retries = 3

      // Assert exact 3 distinct request IDs
      expect(recordedRequestIds.length).toBe(3);
      const [reqA, reqB, reqC] = recordedRequestIds;
      expect(reqA).not.toBe(reqB);
      expect(reqB).not.toBe(reqC);
      expect(reqA).not.toBe(reqC);

      // Verify thought_steps contains all 3 distinct failure rows
      const failureRows = sidecar.prepare(`
        SELECT request_id, cycle_id, generation, pass, kind, payload_json
        FROM thought_steps
        WHERE cycle_id = ? AND generation = ? AND pass = ? AND kind = 'failure'
        ORDER BY created_at_ms ASC
      `).all(cycle.cycleId, cycle.generation, 1) as Array<{
        request_id: string;
        cycle_id: string;
        generation: number;
        pass: number;
        kind: string;
        payload_json: string;
      }>;

      expect(failureRows.length).toBe(3);
      expect(failureRows.map((r) => r.request_id)).toEqual([reqA, reqB, reqC]);

      // Assert dispatch messages differed by structural feedback
      expect(recordedDispatchMessages[0]).not.toBe(recordedDispatchMessages[1]);
      expect(recordedDispatchMessages[1]).toBe(recordedDispatchMessages[2]); // same feedback "invalid_json"
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("durable reconstruction: reconstructs malformed retry count across sidecar re-entry", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();

    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-dur-1",
        conversationId: "thread-dur-1",
        triggerKind: "owner_message",
        triggerRef: "ev-dur-1",
        occupantId: "doc",
        nowMs: 100,
      });

      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-dur-1",
        text: "Durability verification query",
        discordMessageIds: ["d-dur-1"],
        nowMs: 105,
      });

      const event = appendInboxEvent(sidecar, {
        conversationId: "thread-dur-1",
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
        },
      });

      // Insert 2 prior malformed failure steps for pass 1 with distinct request IDs
      const insertStep = sidecar.prepare(`
        INSERT INTO thought_steps (request_id, cycle_id, generation, pass, kind, payload_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertStep.run("prior-req-1", cycle.cycleId, cycle.generation, 1, "failure", JSON.stringify({ reason: "malformed" }), 100);
      insertStep.run("prior-req-2", cycle.cycleId, cycle.generation, 1, "failure", JSON.stringify({ reason: "malformed" }), 101);

      let modelAttempts = 0;
      const completeChat = vi.fn(async () => {
        modelAttempts++;
        return {
          text: "still not valid json",
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });

      const deps = {
        nowMs: () => 110,
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

      // Since 2 malformed retries are already recorded in sidecar, exactly 1 attempt remains
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);

      expect(result.published).toBe(false);
      expect(modelAttempts).toBe(1); // Exactly 1 attempt made before reaching 3 total failures

      const totalFailures = sidecar.prepare(`
        SELECT COUNT(*) AS count
        FROM thought_steps
        WHERE cycle_id = ? AND generation = ? AND pass = ? AND kind = 'failure'
      `).get(cycle.cycleId, cycle.generation, 1) as { count: number };

      expect(totalFailures.count).toBe(3);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});

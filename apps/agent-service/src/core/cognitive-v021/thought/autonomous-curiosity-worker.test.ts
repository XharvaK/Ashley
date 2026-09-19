import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { completionEventIdFor } from "../operation/completion.js";
import { getDetachedOperation } from "../operation/detached.js";
import { enqueueWorkerUndertakingIntent, serviceWorkerUndertakings } from "../operation/dispatch.js";
import { getWorkerUndertaking } from "../operation/worker-queue.js";
import { runCognitiveCycle } from "./run.js";
import { env } from "../../../env.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: true,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: ["project-ashley"],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(async () => {
      throw new Error("direct_observation_must_not_run");
    }),
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

function userPayload(messages: unknown): Record<string, any> {
  const list = messages as Array<{ role: string; content: string }>;
  const user = list.find((message) => message.role === "user");
  return JSON.parse(user?.content ?? "{}");
}

describe("autonomous curiosity through the global worker queue", () => {
  it("runs semantic project.inspect from curiosity through completion and a fresh Thought", async () => {
    const origDiscordOwnerId = env.discordOwnerId;
    env.discordOwnerId = "doc";
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-curiosity-e2e";
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-curiosity-e2e",
      conversationId,
      triggerKind: "idle_opportunity",
      triggerRef: "curiosity:e2e",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const event = appendInboxEvent(sidecar, {
      id: "idle-curiosity-e2e",
      wakeId: cycle.wakeId,
      conversationId,
      kind: "idle_opportunity",
      payload: { cycleId: cycle.cycleId, triggerRef: "curiosity:e2e", ownerId: "doc" },
      createdAtMs: 2,
    });
    const firstCompleteChat = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "observation_intent",
        operationKind: "project.inspect",
        request: {
          projectId: "project-ashley",
          focus: "understand the bounded worker queue",
          maxSteps: 4,
        },
        purpose: "learn the bounded worker queue path",
        evidenceNeed: "bounded worker evidence",
        existingRefs: [],
      }),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const executeObservation = vi.fn();

    try {
      const first = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: firstCompleteChat,
        executeObservation,
        enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
      }));

      expect(first.published).toBe(false);
      expect(first.workerUndertakingId).toBeTruthy();
      expect(executeObservation).not.toHaveBeenCalled();
      const undertaking = getWorkerUndertaking(sidecar, first.workerUndertakingId!);
      expect(undertaking).toMatchObject({
        state: "queued",
        originKind: "ASHLEY_CURIOSITY",
        originRef: "curiosity:e2e",
        semanticKind: "project.inspect",
        selectedOperationId: null,
      });

      const workerInputs: Array<{ request: Record<string, unknown>; operation: { operationId: string } }> = [];
      const serviced = await serviceWorkerUndertakings(sidecar, {
        nowMs: 100,
        worker: async (input) => {
          workerInputs.push(input);
          return { ok: true, payload: { summary: "bounded curiosity evidence" } };
        },
        capacityProbe: () => ({ available: true as const }),
      });

      expect(serviced.serviced).toEqual([first.workerUndertakingId]);
      expect(workerInputs).toHaveLength(1);
      expect(workerInputs[0]?.request).toEqual({
        projectId: "project-ashley",
        focus: "understand the bounded worker queue",
        maxSteps: 4,
      });
      expect(JSON.stringify(workerInputs[0]?.request)).not.toContain("project.read_file");
      const completedUndertaking = getWorkerUndertaking(sidecar, first.workerUndertakingId!);
      expect(completedUndertaking?.state).toBe("succeeded");
      const operationId = completedUndertaking?.selectedOperationId;
      expect(operationId).toBeTruthy();
      expect(getDetachedOperation(sidecar, operationId!)).toMatchObject({
        state: "succeeded",
        terminalState: "succeeded",
        workerUndertakingId: first.workerUndertakingId,
      });

      const completionEvent = getInboxEvent(sidecar, completionEventIdFor(operationId!));
      expect(completionEvent).toMatchObject({ kind: "observation_or_receipt" });
      const completionChat = vi.fn(async (messages: unknown) => {
        const input = userPayload(messages);
        const observation = input.observations?.find(
          (candidate: { observationId?: string }) => candidate.observationId === `v021:observation:detached:${operationId}`,
        );
        expect(observation).toBeTruthy();
        expect(JSON.stringify(observation)).toContain("bounded curiosity evidence");
        return {
          text: JSON.stringify(makeSemanticSettlement({
            speech: {
              mode: "draft",
              mustSay: ["bounded curiosity evidence"],
              surfaceDraft: "I found bounded curiosity evidence.",
            },
            evidenceUse: {
              observationRefsUsed: [observation.observationId],
              retrievalRefsUsed: [],
              sourceRefsUsed: [],
              openIntentRefs: [],
            },
          })),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });

      const fresh = await runCognitiveCycle(sidecar, attentionDb, completionEvent!, deps({
        attentionDb,
        nowMs: () => 200,
        completeChat: completionChat,
        executeObservation: vi.fn(),
      }));
      expect(fresh.published).toBe(true);
      expect(fresh.cycleId).not.toBe(cycle.cycleId);
      expect(completionChat).toHaveBeenCalledTimes(1);
      expect(completionEvent?.payload).toMatchObject({ originKind: "ASHLEY_CURIOSITY" });
      expect((completionEvent?.payload as Record<string, unknown>)?.ownerId).toBeUndefined();
    } finally {
      env.discordOwnerId = origDiscordOwnerId;
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});

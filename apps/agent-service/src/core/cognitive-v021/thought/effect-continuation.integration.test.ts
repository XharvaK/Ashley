import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { env } from "../../../env.js";
import { v2CapabilitySpec } from "@composer-assistant/sandbox-v2";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { getInFlight } from "../effect/in-flight.js";
import { getEffectContinuation } from "../effect/continuation.js";
import { LONG_OPERATION_HORIZON_MS } from "../../sandbox/worker/contracts.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { runLiveCognitiveTurn } from "../dispatch/live.js";
import { startDurableAttempt } from "../retry/ledger.js";
import type { CapabilityReality, EffectReceipt, IdentitySlice, KernelDeps } from "../types.js";

const BASE = 1_800_000_000_000;
const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const workspaceWriteSpec = v2CapabilitySpec("workspace.write_file");
if (!workspaceWriteSpec) throw new Error("workspace_write_capability_missing");
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: true,
  canOfferWorkspace: true,
  canOfferVerification: true,
  canOfferAuthorship: true,
  canOfferBoundedOperation: true,
  canOfferIterativeEngineering: true,
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: ["project-ashley"],
  operationCapabilities: [{
    operationKind: "candidate.develop",
    semanticClass: "effect",
    label: "Candidate development",
    description: "Run bounded candidate development in the approved workspace.",
    inputContract: "Requires projectId and the operator-bound workspaceId.",
    outputContract: "Returns a bounded effect receipt.",
    evidenceContract: "The receipt describes worker activity and does not prove verification.",
    authorityConditions: ["The project and candidate workspace are authorized."],
    hardLimits: ["No apply, commit, push, or deploy."],
    uncertainty: ["Unknown work is not relaunched."],
    family: workspaceWriteSpec.family,
    readOnly: false,
    requiresProject: true,
    available: true,
    unavailableReasons: [],
    requiredRequestFields: ["projectId"],
    optionalRequestFields: ["workspaceId", "focus", "maxSteps"],
    operatorBoundRequestFields: ["workspaceId"],
    authorizedProjectIds: ["project-ashley"],
  }],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => Date.now(),
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "fake",
      resolvedModelId: null,
    })),
    runPerception: vi.fn(async () => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(async () => ({
      outcome: "succeeded",
      receiptId: "receipt-default",
      effectId: "effect-default",
      idempotencyKey: "idem-default",
      claims: { executionTruth: "effect_verified", terminationClass: "SUCCESS" },
      atMs: Date.now(),
      dataClassification: "never_public",
      secretOmitted: true,
    } satisfies EffectReceipt)),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: false },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: true },
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

function ownerEvent(
  sidecar: ReturnType<typeof openTestSidecar>,
  conversationId: string,
  eventTag: string,
) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${conversationId}-${eventTag}`,
    conversationId,
    triggerKind: "owner_message",
    triggerRef: `owner-${eventTag}`,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: Date.now(),
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId,
    text: "Make the bounded candidate change and tell me when it finishes.",
    discordMessageIds: [`discord-${eventTag}`],
    nowMs: Date.now(),
  });
  return appendInboxEvent(sidecar, {
    conversationId,
    kind: "owner_message",
    payload: {
      cycleId: cycle.cycleId,
      evidenceRowId: evidence.rowId,
      ownerId: "doc",
      channel: "discord",
      threadId: conversationId,
    },
    createdAtMs: Date.now(),
  });
}

function userPayload(messages: unknown): Record<string, unknown> {
  const list = messages as Array<{ role: string; content: string }>;
  const user = list.find((message) => message.role === "user");
  return JSON.parse(user?.content ?? "{}");
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("develop effect continuation integration", () => {
  it("finishes the Thought leg, waits five hours, and resumes on one fixed-deadline completion wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const attentionDb = openTestSidecar();
    const conversationId = "thread-develop-continuation";
    const originalOwnerId = env.discordOwnerId;
    let releaseWorker!: (receipt: EffectReceipt) => void;
    const workerGate = new Promise<EffectReceipt>((resolve) => { releaseWorker = resolve; });
    const executeEffect = vi.fn(async () => workerGate);
    let thoughtCallCount = 0;
    const completeChat = vi.fn(async (_messages: unknown) => {
      if (thoughtCallCount++ === 0) {
        return {
          text: JSON.stringify({
            kind: "effect_intent",
            operationKind: "candidate.develop",
            request: {
              projectId: "project-ashley",
              workspaceId: "workspace-ashley",
            },
            purpose: "make the bounded candidate change",
            expectedOutcome: "the bounded candidate change has been applied",
            existingRefs: [],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement({ speech: { mode: "none" } })),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });
    try {
      env.discordOwnerId = "doc";
      const originEvent = ownerEvent(sidecar, conversationId, "develop-a");
      const attempt = startDurableAttempt(sidecar, {
        eventId: originEvent.id,
        workerId: "continuation-test-worker",
        nowMs: Date.now(),
      });
      const claimedEvent = getInboxEvent(sidecar, originEvent.id);
      if (!claimedEvent) throw new Error("continuation_test_claim_missing");
      const firstTurn = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: { ...claimedEvent, durableAttemptId: attempt.attemptId },
        deps: deps({ attentionDb, completeChat, executeEffect }),
      });
      expect(firstTurn.effectContinuationId).toBeTruthy();
      const effectId = firstTurn.effectContinuationId!;
      expect(getInFlight(sidecar, effectId)?.audienceScope).toBeTruthy();
      const initial = getEffectContinuation(sidecar, effectId);
      expect(initial).toMatchObject({
        state: "running",
        deadlineAtMs: BASE + LONG_OPERATION_HORIZON_MS,
        remainingEffectRounds: 3,
      });
      expect(sidecar.prepare("SELECT 1 FROM cognition_claims WHERE conversation_id = ?")
        .get(conversationId)).toBeUndefined();

      await flushMicrotasks();
      expect(executeEffect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
      expect(getEffectContinuation(sidecar, effectId)?.deadlineAtMs).toBe(initial?.deadlineAtMs);
      expect(getEffectContinuation(sidecar, effectId)?.state).toBe("running");

      releaseWorker({
        receiptId: `receipt-${effectId}`,
        effectId,
        idempotencyKey: `idem-${effectId}`,
        outcome: "succeeded",
        claims: { executionTruth: "effect_verified", terminationClass: "SUCCESS" },
        atMs: Date.now(),
        dataClassification: "never_public",
        secretOmitted: true,
      });
      await flushMicrotasks();

      const completionEventId = `operation:${effectId}:completion`;
      const completionEvent = getInboxEvent(sidecar, completionEventId);
      expect(env.discordOwnerId).toBe("doc");
      expect(completionEvent).toMatchObject({
        id: completionEventId,
        kind: "observation_or_receipt",
        payload: {
          effectId,
          effectContinuationId: effectId,
          terminalClass: "SUCCESS",
          effectTruth: "effect_verified",
          deadlineAtMs: initial?.deadlineAtMs,
          remainingEffectRounds: 3,
        },
      });
      expect(getEffectContinuation(sidecar, effectId)).toMatchObject({
        state: "succeeded",
        deadlineAtMs: initial?.deadlineAtMs,
        completionEventRef: completionEventId,
      });

      const completionTurn = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: completionEvent!,
        deps: deps({ attentionDb, completeChat, executeEffect }),
      });
      expect(completionTurn.published).toBe(true);
      expect(completeChat).toHaveBeenCalledTimes(2);
      const completionInput = userPayload(completeChat.mock.calls[1]?.[0]);
      expect(completionInput.effectBudget).toEqual({
        maxEffectRounds: 4,
        usedEffectRounds: 1,
        remainingEffectRounds: 3,
      });
      expect(getEffectContinuation(sidecar, effectId)?.deadlineAtMs).toBe(initial?.deadlineAtMs);
    } finally {
      env.discordOwnerId = originalOwnerId;
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });
});

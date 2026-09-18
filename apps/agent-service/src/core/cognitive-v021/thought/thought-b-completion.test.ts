import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { dispatchDetachedOperation } from "../operation/dispatch.js";
import { admitDetachedOperation, getDetachedOperation } from "../operation/detached.js";
import { supersedeDetachedOperation } from "../operation/detached.js";
import { authorizeInterimSpeech } from "../operation/interim.js";
import { runCognitiveCycle } from "./run.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
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
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

async function thoughtAWithCompletion(threadId: string) {
  const sidecar = openTestSidecar();
  const attentionDb = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${threadId}`,
    conversationId: threadId,
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  appendOwnerUtterance(sidecar, {
    conversationId: threadId, text: "investigate the service", discordMessageIds: ["d1"], nowMs: 2,
  });
  const admitted = admitDetachedOperation(sidecar, {
    idempotencyKey: `detached:${threadId}:${cycle.cycleId}:project.investigate`,
    conversationId: threadId,
    originCycleId: cycle.cycleId,
    originGeneration: cycle.generation,
    originKind: "OWNER_REQUEST",
    originRef: "owner-1",
    originOwnerEventId: "owner-1",
    operationKind: "project.investigate",
    request: { projectId: "project-ashley", focus: "apps/agent-service" },
    purpose: "investigate the service",
    evidenceNeed: "bounded file evidence",
    operationDeadlineAtMs: 301_000,
    nowMs: 1_000,
  });
  if (!admitted.ok) throw new Error("admission failed");
  const interim = authorizeInterimSpeech(sidecar, {
    operationId: admitted.operation.operationId,
    surfaceDraft: "Yeah, give me a bit. I'm going to look through it.",
    deliveryIntent: {
      ownerId: "doc", channel: "discord", threadId, conversationId: threadId,
      trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech",
    },
    origin: "live",
    nowMs: 1_000,
  });
  if (!interim.ok) throw new Error("interim authorization failed");
  const dispatched = await dispatchDetachedOperation(
    sidecar,
    admitted.operation.operationId,
    async () => ({ ok: true, payload: { summary: "the service retries with backoff" } }),
  );
  if (!dispatched.ok) throw new Error("dispatch failed");
  return { sidecar, attentionDb, nuclear, cycle, operationId: admitted.operation.operationId };
}

function userPayload(messages: unknown): { observations: Array<{ observationId: string }>; rawConversation: Array<{ text?: string }> } {
  const list = messages as Array<{ role: string; content: string }>;
  const user = list.find((message) => message.role === "user");
  return JSON.parse(user?.content ?? "{}");
}

describe("Thought B from operation completion", () => {
  it("answers from worker evidence with current context and clears the pending obligation", async () => {
    const { sidecar, attentionDb, nuclear, cycle, operationId } = await thoughtAWithCompletion("thread-thought-b");
    try {
      const operation = getDetachedOperation(sidecar, operationId);
      expect(operation?.completionEventRef).toBe(`operation:${operationId}:completion`);
      // An intervening Owner turn lands before Ashley returns.
      appendOwnerUtterance(sidecar, {
        conversationId: cycle.conversationId, text: "any update?", discordMessageIds: ["d2"], nowMs: 8_000,
      });
      const completionEvent = getInboxEvent(sidecar, `operation:${operationId}:completion`);
      expect(completionEvent?.kind).toBe("observation_or_receipt");
      expect(completionEvent?.wakeId).not.toBe(cycle.wakeId);

      const completeChat = vi.fn(async (_messages: unknown) => ({
        text: JSON.stringify(makeSemanticSettlement({
          interpretation: { discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: ["findings"] },
          commitments: {
            conversational: ["answer"],
            stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
          },
          speech: { mode: "draft", mustSay: ["backoff"], surfaceDraft: "I looked through it: the service retries with backoff." },
        })),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      }));
      const result = await runCognitiveCycle(sidecar, attentionDb, completionEvent!, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(true);

      // Thought B input carried the full completion context.
      const input = userPayload(completeChat.mock.calls[0]?.[0]);
      const observationIds = input.observations.map((observation) => observation.observationId);
      expect(observationIds).toContain(`v021:observation:detached:${operationId}`);
      const workerObservation = input.observations.find(
        (observation) => observation.observationId === `v021:observation:detached:${operationId}`,
      );
      expect(JSON.stringify(workerObservation)).toContain("backoff");
      const conversationText = input.rawConversation.map((entry) => entry.text ?? "").join("\n");
      expect(conversationText).toContain("Detached investigation succeeded");
      expect(conversationText).toContain("Yeah, give me a bit");
      expect(conversationText).toContain("any update?");
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("lets a superseded completion resolve silently without forced speech", async () => {
    const { sidecar, attentionDb, nuclear, operationId } = await thoughtAWithCompletion("thread-thought-b-superseded");
    try {
      expect(supersedeDetachedOperation(sidecar, operationId, {
        supersededBy: "owner-turn-2",
        nowMs: 9_000,
      }).ok).toBe(true);
      const completionEvent = getInboxEvent(sidecar, `operation:${operationId}:completion`);
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify({
          kind: "abstain",
          reason: "insufficient_evidence",
          explanation: "Superseded by the newer turn; silence is the responsible act.",
          evidenceRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      }));
      const result = await runCognitiveCycle(sidecar, attentionDb, completionEvent!, deps({ attentionDb, completeChat }));
      // Completion is reason to think, not forced speech: consumable, silent.
      expect(result.published).toBe(false);
      expect(result.ownerObligationResolution?.ownerObligationOutcome).toBe("not_applicable");
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("keeps worker wall-clock out of Thought B budget", async () => {
    const { sidecar, attentionDb, nuclear, cycle, operationId } = await thoughtAWithCompletion("thread-thought-b-budget");
    try {
      // The completion runs on a new wake/cycle admitted after the worker
      // finished: Thought B opens a fresh Thought leg, never a resume of
      // Thought A's consumed budget.
      const completionEvent = getInboxEvent(sidecar, `operation:${operationId}:completion`);
      const completionCycleId = (completionEvent?.payload as Record<string, unknown>)?.cycleId;
      expect(typeof completionCycleId === "string").toBe(true);
      expect(completionCycleId).not.toBe(cycle.cycleId);
      expect(Number(completionEvent?.createdAtMs)).toBeGreaterThanOrEqual(1_000);
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});

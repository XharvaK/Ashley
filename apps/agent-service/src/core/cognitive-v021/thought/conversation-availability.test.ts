import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { finalizeDelivery } from "../../delivery/finalize.js";
import { recordBubbleReceipt } from "../../delivery/store.js";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar, makeSemanticSettlement } from "../test-support.js";
import { runLiveCognitiveTurn } from "../dispatch/live.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import { claimPendingCognitiveDeliveries } from "../delivery/pending.js";
import { reconcileProjectedDelivery } from "../delivery/outbox-projector.js";
import { enqueueWorkerUndertakingIntent, serviceWorkerUndertakings } from "../operation/dispatch.js";
import { getDetachedOperation } from "../operation/detached.js";
import { getInterimOutboxByUndertaking } from "../operation/interim.js";
import { getWorkerUndertaking } from "../operation/worker-queue.js";
import { CONVERSATION_COGNITION_OCCUPIED } from "../cycle/cognition-claim.js";
import type { CapabilityReality, IdentitySlice, KernelDeps } from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
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
    completeChat: vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "fake", resolvedModelId: null,
    })),
    runPerception: vi.fn(async () => []),
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
    ...overrides,
  };
}

function ownerEvent(
  sidecar: ReturnType<typeof openTestSidecar>,
  threadId: string,
  cycleTag: string,
  text: string,
  discordId: string,
) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${threadId}-${cycleTag}`,
    conversationId: threadId,
    triggerKind: "owner_message",
    triggerRef: `owner-${cycleTag}`,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: threadId,
    text,
    discordMessageIds: [discordId],
    nowMs: 2,
  });
  return appendInboxEvent(sidecar, {
    conversationId: threadId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerId: "doc", channel: "discord", threadId },
    createdAtMs: 2,
  });
}

function userPayload(messages: unknown): { observations: Array<{ observationId: string; payload?: unknown }>; rawConversation: Array<{ text?: string }> } {
  const list = messages as Array<{ role: string; content: string }>;
  const user = list.find((message) => message.role === "user");
  return JSON.parse(user?.content ?? "{}");
}

/** Drive one projected reservation through claim, receipt, and reconciliation. */
function deliverReserved(
  nuclear: DatabaseSync,
  sidecar: ReturnType<typeof openTestSidecar>,
  ownerId: string,
  reservationId: number,
  discordMessageId: string,
): void {
  const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId });
  expect(claimed.map((delivery) => delivery.reservationId)).toContain(reservationId);
  recordBubbleReceipt(nuclear, reservationId, 0, discordMessageId);
  finalizeDelivery(nuclear, { reservationId, ownerId, cause: "complete" });
  expect(reconcileProjectedDelivery(sidecar, nuclear, reservationId)).toBe(true);
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("conversation stays available during detached work", () => {
  it("handles a later Owner turn, queues completion behind active Thought, then resumes with current context", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const attentionDb = openTestSidecar();
    const projector = createOutboxProjector(sidecar, nuclear);
    const projectOutbox = (outboxId: number) => projector.project(outboxId);
    const threadId = "thread-model2";
    let releaseWorker: (() => void) | undefined;
    const workerGate = new Promise<{ ok: true; payload: unknown }>((resolve) => {
      releaseWorker = () => resolve({ ok: true, payload: { summary: "backoff configured" } });
    });
    try {
      // Turn A queues an investigation with an interim hold.
      const turnA = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: ownerEvent(sidecar, threadId, "a", "investigate the service", "discord-a"),
        deps: deps({
          attentionDb,
          projectOutbox,
          completeChat: vi.fn(async () => ({
            text: JSON.stringify({
              kind: "observation_intent",
              operationKind: "project.inspect",
              request: { projectId: "project-ashley", focus: "apps/agent-service" },
              purpose: "investigate the service",
              evidenceNeed: "bounded file evidence",
              existingRefs: [],
              interimSpeech: { mode: "hold", surfaceDraft: "Yeah, give me a bit. I'm going to look through it." },
            }),
            model: "fake", modelAlias: "thought", resolvedModelId: null,
          })),
          enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
          projectInterim: (interimId) => projector.projectInterim(interimId),
        }),
        projector,
      });
      expect(turnA.workerUndertakingId).toMatch(/^worker-undertaking:/);
      const undertakingId = turnA.workerUndertakingId!;
      const workerService = serviceWorkerUndertakings(sidecar, {
        nowMs: 20,
        worker: async () => workerGate,
        capacityProbe: () => ({ available: true as const }),
      });
      await waitFor(() => getWorkerUndertaking(sidecar, undertakingId)?.state === "running");
      const operationId = getWorkerUndertaking(sidecar, undertakingId)?.selectedOperationId;
      if (!operationId) throw new Error("queue did not bind an operation");
      expect(getDetachedOperation(sidecar, operationId)?.state).toBe("started");

      // The interim hold reaches the Owner through the standard pump seam.
      const interimKey = getInterimOutboxByUndertaking(sidecar, undertakingId)?.projectionKey;
      if (!interimKey) throw new Error("detached operation did not persist an interim outbox reference");
      const interimReservation = nuclear.prepare(
        "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(interimKey) as { id: number };
      deliverReserved(nuclear, sidecar, "doc", Number(interimReservation.id), "discord-interim-1");

      // Turn B arrives while the worker still runs. Its Thought blocks in
      // the provider, holding the conversation claim.
      let bCalls = 0;
      let releaseB: (() => void) | undefined;
      const bGate = new Promise<void>((resolve) => { releaseB = resolve; });
      const completeChatB = vi.fn(async (_messages: unknown) => {
        bCalls += 1;
        if (bCalls === 1) await bGate;
        return {
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", mustSay: ["still here"], surfaceDraft: "Still here, still looking — still here." },
          })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      });
      const turnB = runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: ownerEvent(sidecar, threadId, "b", "any update?", "discord-b"),
        deps: deps({ attentionDb, projectOutbox, completeChat: completeChatB }),
        projector,
      });
      await waitFor(() => bCalls === 1);

      // The worker finishes mid-Thought-B: the completion opportunity waits
      // behind the active Thought instead of running concurrently.
      releaseWorker?.();
      await waitFor(() => getDetachedOperation(sidecar, operationId)?.state === "succeeded");
      await workerService;
      const completionId = `operation:${operationId}:completion`;
      expect(getInboxEvent(sidecar, completionId)?.kind).toBe("observation_or_receipt");
      const completionEvent = getInboxEvent(sidecar, completionId)!;
      await expect(runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: { ...completionEvent, id: `${completionEvent.id}:probe` },
        deps: deps({ attentionDb }),
        projector,
      })).rejects.toThrow();
      // (probe above uses a synthetic id; the real completion still waits.)

      // Turn B settles normally with pending-operation context, undisturbed
      // by the finished worker: no second Thought ran concurrently.
      releaseB?.();
      const settledB = await turnB;
      expect(settledB).toMatchObject({ published: true });
      const inputB = userPayload(completeChatB.mock.calls[0]?.[0]);
      expect(inputB.rawConversation.map((entry) => entry.text ?? "").join("\n")).toContain(
        "Yeah, give me a bit",
      );
      // B's speech delivers so Thought C sees the newer Ashley turn.
      const speechKey = sidecar.prepare(
        "SELECT projection_key FROM speech_outbox WHERE conversation_id = ? ORDER BY outbox_id DESC LIMIT 1",
      ).get(threadId) as { projection_key: string };
      const speechReservation = nuclear.prepare(
        "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(speechKey.projection_key) as { id: number };
      deliverReserved(nuclear, sidecar, "doc", Number(speechReservation.id), "discord-b-1");

      // Turn C (the completion) runs with current context: the newer Owner
      // turn, B's answer, the interim hold, and the worker evidence.
      const completeChatC = vi.fn(async (_messages: unknown) => ({
        text: JSON.stringify(makeSemanticSettlement({
          speech: { mode: "draft", mustSay: ["backoff"], surfaceDraft: "Done: backoff configured." },
        })),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      }));
      const turnC = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: completionEvent,
        deps: deps({ attentionDb, projectOutbox, completeChat: completeChatC }),
        projector,
      });
      expect(turnC).toMatchObject({ published: true });
      const inputC = userPayload(completeChatC.mock.calls[0]?.[0]);
      expect(inputC.observations.map((observation) => observation.observationId)).toContain(
        `v021:observation:detached:${operationId}`,
      );
      const textC = inputC.rawConversation.map((entry) => entry.text ?? "").join("\n");
      expect(textC).toContain("any update?");
      expect(textC).toContain("still here");
      expect(textC).toContain("Detached investigation succeeded");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });
});

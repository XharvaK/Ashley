import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar, makeSemanticSettlement } from "../test-support.js";
import { runLiveCognitiveTurn } from "./live.js";
import type { CapabilityReality, IdentitySlice, InboxEvent, KernelDeps } from "../types.js";
import {
  CONVERSATION_COGNITION_OCCUPIED,
  readConversationCognition,
} from "../cycle/cognition-claim.js";

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

function ownerEvent(sidecar: ReturnType<typeof openTestSidecar>, threadId: string, cycleTag: string, text: string) {
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
    discordMessageIds: [`discord-${threadId}-${cycleTag}`],
    nowMs: 2,
  });
  return appendInboxEvent(sidecar, {
    conversationId: threadId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerId: "doc", channel: "discord", threadId },
    createdAtMs: 2,
  });
}
/** Gated provider: first call blocks until released, later calls settle at once. */
function gatedProvider() {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const completeChat = vi.fn(async (_messages: unknown) => {
    calls += 1;
    if (calls === 1) await gate;
    return {
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "fake", resolvedModelId: null,
    };
  });
  return {
    completeChat,
    callCount: () => calls,
    release: () => release?.(),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("single active Thought per conversation", () => {
  it("refuses a same-conversation turn with zero provider work while one Thought runs", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    const provider = gatedProvider();
    const projector = { project: vi.fn(async () => undefined), projectSystem: vi.fn(async () => undefined) };
    try {
      const firstEvent = ownerEvent(sidecar, "thread-c1", "a", "first");
      const first = runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: firstEvent,
        deps: deps({ attentionDb, completeChat: provider.completeChat, projectOutbox: projector.project }),
        projector,
      });
      await waitFor(() => provider.callCount() === 1);

      // Same conversation, second driver: refused before any provider work.
      // The competing turn reuses the live cycle identity (like a racing
      // coordinator dispatch): no newer cycle is admitted, so the first
      // Thought stays current and the refusal isolates the claim alone.
      const racingEvent: InboxEvent = {
        ...firstEvent,
        id: "racing-event-b",
        payload: { ...(firstEvent.payload as Record<string, unknown>), triggerRef: "owner-b" },
      };
      await expect(runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: racingEvent,
        deps: deps({ attentionDb, completeChat: provider.completeChat }),
        projector,
      })).rejects.toThrow(CONVERSATION_COGNITION_OCCUPIED);
      expect(provider.callCount()).toBe(1);

      // A different conversation is unaffected and proceeds concurrently.
      const other = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: ownerEvent(sidecar, "thread-c2", "a", "other"),
        deps: deps({ attentionDb, completeChat: provider.completeChat }),
        projector,
      });
      expect(other).toMatchObject({ published: true });
      expect(provider.callCount()).toBe(2);

      // The first Thought finishes; its claim releases exactly once.
      provider.release();
      const settled = await first;
      expect(settled).toMatchObject({ published: true });
      expect(readConversationCognition(sidecar, "thread-c1")).toBe(null);

      // The refused turn retries naturally once the holder is gone.
      const retry = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: ownerEvent(sidecar, "thread-c1", "c", "retry"),
        deps: deps({ attentionDb, completeChat: provider.completeChat }),
        projector,
      });
      expect(retry).toMatchObject({ published: true });
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });
});

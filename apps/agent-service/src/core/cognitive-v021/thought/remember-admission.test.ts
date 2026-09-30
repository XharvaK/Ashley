import { describe, expect, it, vi } from "vitest";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { runCognitiveCycle } from "./run.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";

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

describe("/remember admission", () => {
  it("records one admission decision for a directive nomination (R23)", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-remember-once",
        conversationId: "thread-remember-once",
        triggerKind: "owner_message",
        triggerRef: "owner-remember-once",
        occupantId: "alex",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-remember-once",
        text: "I prefer small tools.",
        discordMessageIds: ["remember-once-1"],
        nowMs: 2,
      });
      const event = appendInboxEvent(sidecar, {
        wakeId: cycle.wakeId,
        conversationId: "thread-remember-once",
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
          rememberRequested: true,
          evidenceLineageId: evidence.lineageId,
          dataClassification: "ordinary",
        },
        createdAtMs: 2,
      });
      // No quote grounding: the grounded catch-up alone would skip this
      // nomination, while the /remember directive admits it.
      const settlement = {
        ...makeSemanticSettlement(),
        durableNominations: [{
          statement: "The owner prefers small tools.",
          memoryKind: "owner_preference",
          dimensions: {
            source: "owner_utterance",
            status: "asserted",
            time: "historical",
            reliability: "owner_supplied",
          },
          dataClassification: "ordinary",
          sourceRefs: [],
          supersedesRef: null,
          concernRef: null,
        }],
      };
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(settlement),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));

      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));

      expect(result.published).toBe(true);
      const decisions = sidecar.prepare("SELECT result FROM admission_log").all() as Array<{ result: string }>;
      expect(decisions.map((row) => row.result)).toEqual(["admitted"]);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});

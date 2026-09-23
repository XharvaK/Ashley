import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { incrementThoughtAttemptCounter } from "./counters.js";
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

function setupThread(
  sidecar: DatabaseSync,
  conversationId: string,
  cycleId: string,
  triggerRef: string,
) {
  const cycle = admitTestCycle(sidecar, {
    cycleId,
    conversationId,
    triggerKind: "owner_message",
    triggerRef,
    occupantId: "doc",
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId,
    text: "discover a concern",
    discordMessageIds: [`${cycleId}-message`],
    nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId,
    kind: "owner_message",
    payload: { cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
    createdAtMs: 2,
  });
  return { cycle, evidence, event };
}

function seedResolvedConcerns(sidecar: DatabaseSync, conversationId: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    applyConcernDelta(sidecar, {
      op: "upsert",
      record: {
        concernId: `concern-boundary-${String(index).padStart(2, "0")}`,
        conversationId,
        statement: `Boundary concern ${index}.`,
        sourceTurnIds: [],
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        assertionKey: null,
        status: "resolved",
      },
    }, { cycleId: "cycle-boundary-seed", generation: 1 });
  }
}

function discoverText(evidenceRowId: string): string {
  return JSON.stringify({
    kind: "observation_intent",
    operationKind: "concern.inspect",
    request: { discover: { limit: 64 } },
    purpose: "page inspectable concerns",
    evidenceNeed: "content-free concern ids",
    existingRefs: [evidenceRowId],
  });
}

function discoveryObservation(cycleId: string, generation: number, concernId: string): Observation {
  return {
    observationId: `observation-${cycleId}`,
    cycleId,
    generation,
    derived: false,
    replaySafe: true,
    modality: "tool",
    payload: {
      result: "page",
      concerns: [{ concernId, cognitiveStatus: "resolved", quarantineKind: null }],
      omittedCount: 0,
      nextCursor: null,
    },
    provenance: "sidecar:concern.inspect",
    dataClassification: "never_public",
    secretOmitted: false,
  };
}

describe("C2 concern discovery lifecycle boundaries", () => {
  it("does not defer discovered authority when discovery is the final pass", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-discovery-final-pass";
    const { cycle, evidence, event } = setupThread(
      sidecar,
      conversationId,
      "cycle-discovery-final-pass",
      "owner-discovery-final-pass",
    );
    seedResolvedConcerns(sidecar, conversationId, 33);
    for (let index = 0; index < 5; index += 1) {
      incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "acceptedThoughtPasses");
    }
    const completeChat = vi.fn(async () => ({
      text: discoverText(evidence.rowId),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const executeObservation = vi.fn(async () => discoveryObservation(
      cycle.cycleId,
      cycle.generation,
      "concern-boundary-32",
    ));

    try {
      const result = await runCognitiveCycle(sidecar, nuclear, event, deps({
        attentionDb: nuclear,
        completeChat,
        executeObservation,
      }));

      expect(result.published).toBe(false);
      expect(result.acceptedThoughtPasses).toBe(6);
      expect(completeChat).toHaveBeenCalledTimes(1);
      expect(executeObservation).toHaveBeenCalledTimes(1);
      expect(sidecar.prepare(
        "SELECT cognitive_status FROM concerns WHERE concern_id = ?",
      ).get("concern-boundary-32")).toMatchObject({ cognitive_status: "resolved" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("does not carry a discovery grant into the next cycle", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-discovery-next-cycle";
    seedResolvedConcerns(sidecar, conversationId, 33);
    const first = setupThread(sidecar, conversationId, "cycle-discovery-first", "owner-discovery-first");
    for (let index = 0; index < 5; index += 1) {
      incrementThoughtAttemptCounter(sidecar, first.cycle.cycleId, first.cycle.generation, "acceptedThoughtPasses");
    }
    const farConcernId = "concern-boundary-32";
    const firstCompleteChat = vi.fn(async () => ({
      text: discoverText(first.evidence.rowId),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const firstExecuteObservation = vi.fn(async () => discoveryObservation(
      first.cycle.cycleId,
      first.cycle.generation,
      farConcernId,
    ));

    try {
      const firstResult = await runCognitiveCycle(sidecar, nuclear, first.event, deps({
        attentionDb: nuclear,
        completeChat: firstCompleteChat,
        executeObservation: firstExecuteObservation,
      }));
      expect(firstResult.published).toBe(false);

      const second = setupThread(sidecar, conversationId, "cycle-discovery-second", "owner-discovery-second");
      const secondCompleteChat = vi.fn(async () => ({
        text: JSON.stringify(makeSemanticSettlement({
          speech: { mode: "none" },
          evidenceUse: {
            observationRefsUsed: [],
            retrievalRefsUsed: [],
            sourceRefsUsed: [second.evidence.rowId],
            openIntentRefs: [],
          },
          concernDeltas: [{
            op: "upsert",
            record: {
              identity: { kind: "existing", ref: farConcernId },
              statement: "Must not cross the cycle boundary.",
              sourceTurnRefs: [second.evidence.rowId],
              dimensions: { source: "ashley_interpretation", status: "asserted", time: "current", reliability: "inferred" },
              status: "active",
            },
          }],
        })),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));
      const secondResult = await runCognitiveCycle(sidecar, nuclear, second.event, deps({
        attentionDb: nuclear,
        completeChat: secondCompleteChat,
      }));

      expect(secondResult.published).toBe(false);
      expect(sidecar.prepare(
        "SELECT cognitive_status, statement FROM concerns WHERE concern_id = ?",
      ).get(farConcernId)).toMatchObject({
        cognitive_status: "resolved",
        statement: "Boundary concern 32.",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

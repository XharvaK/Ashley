import { describe, expect, it, vi } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import {
  thoughtOutputCompatibilityInstruction,
  thoughtOutputStructuredRequest,
} from "./output-contract.js";
import { MEMORY_KINDS } from "../memory/kinds.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { getCycle } from "../cycle/inbox.js";
import { getWake } from "../wake/ledger.js";
import { runCognitiveCycle } from "./run.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";

const refs = new Set(["turn-1", "observation-1"]);

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

function invalidSettlement() {
  const base = makeSemanticSettlement();
  return {
    ...base,
    durableNominations: [
      {
        statement: "The owner prefers small tools.",
        memoryKind: "self_reflection",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        },
        dataClassification: "ordinary",
        // Empty refs isolate the MemoryKind defect from reference allowlisting.
        sourceRefs: [],
        supersedesRef: null,
        concernRef: null,
      },
    ],
  };
}

function validSettlement() {
  const base = makeSemanticSettlement();
  return {
    ...base,
    durableNominations: [
      {
        statement: "The owner prefers small tools.",
        memoryKind: "owner_preference",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        },
        dataClassification: "ordinary",
        sourceRefs: [],
        supersedesRef: null,
        concernRef: null,
      },
    ],
  };
}

describe("nomination MemoryKind structural boundary", () => {
  it("constrains the model-facing schema to the canonical enum", () => {
    expect(MEMORY_KINDS).toHaveLength(11);
    expect(MEMORY_KINDS).toContain("owner_preference");
    expect(MEMORY_KINDS).not.toContain("self_reflection" as never);

    const request = thoughtOutputStructuredRequest();
    const schema = request.schema as {
      oneOf: Array<{
        properties?: Record<string, unknown>;
      }>;
    };
    const settlement = schema.oneOf.find(
      (branch) => (branch.properties?.kind as { const?: string } | undefined)?.const === "settlement",
    );
    const settlementProps = settlement?.properties as Record<string, unknown> | undefined;
    const nominations = (settlementProps?.durableNominations as { items?: Record<string, unknown> } | undefined)?.items;
    const nominationProps = nominations?.properties as Record<string, { enum?: string[] }> | undefined;
    expect(nominationProps?.memoryKind?.enum).toEqual(expect.arrayContaining([...MEMORY_KINDS]));
    expect(nominationProps?.memoryKind?.enum).not.toContain("self_reflection");
  });

  it("rejects memoryKind=self_reflection at the structural Thought boundary before publication", () => {
    const result = parseThoughtSemanticOutput(invalidSettlement(), refs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("durableNominations");
    }
  });

  it("recovers through the bounded structural retry to one lawful settlement and one outbox", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-nom-retry",
        conversationId: "thread-nom-retry",
        triggerKind: "owner_message",
        triggerRef: "owner-nom-retry",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-nom-retry",
        text: "remember small tools",
        discordMessageIds: ["nom-retry-1"],
        nowMs: 2,
      });
      const event = appendInboxEvent(sidecar, {
        wakeId: cycle.wakeId,
        conversationId: "thread-nom-retry",
        kind: "owner_message",
        payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
        createdAtMs: 2,
      });
      let calls = 0;
      const completeChat = vi.fn(async () => {
        calls += 1;
        return {
          text: JSON.stringify(calls === 1 ? invalidSettlement() : validSettlement()),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(calls).toBe(2);
      expect(result.published).toBe(true);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 1 });
      expect(sidecar.prepare("SELECT memory_kind FROM durable_nominations").get()).toMatchObject({
        memory_kind: "owner_preference",
      });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("fails closed on persistent invalid output without reconciling limbo", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-nom-persist",
        conversationId: "thread-nom-persist",
        triggerKind: "owner_message",
        triggerRef: "owner-nom-persist",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: "thread-nom-persist",
        text: "remember small tools",
        discordMessageIds: ["nom-persist-1"],
        nowMs: 2,
      });
      const event = appendInboxEvent(sidecar, {
        wakeId: cycle.wakeId,
        conversationId: "thread-nom-persist",
        kind: "owner_message",
        payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
        createdAtMs: 2,
      });
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(invalidSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(false);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
      // Lawful terminal failure path: cycle silent, no reconciling limbo.
      expect(getCycle(sidecar, cycle.cycleId)?.state).toBe("silent");
      expect(getWake(sidecar, cycle.wakeId)?.state).not.toBe("reconciling");
      expect(sidecar.prepare("SELECT state FROM inbox_events WHERE id = ?").get(event.id)).not.toMatchObject({
        state: "reconciling",
      });
      void thoughtOutputCompatibilityInstruction;
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});

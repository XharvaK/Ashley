import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import {
  admitTestCycle,
  makeSemanticSettlement,
  openTestSidecar,
} from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { runCognitiveCycle } from "./run.js";

const constitution: IdentitySlice = {
  constitutional: ["truth first"],
  stableSelf: ["inspect only when it can answer the question"],
};

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

function deps(
  attentionDb: DatabaseSync,
  completeChat: KernelDeps["completeChat"],
  executeObservation: KernelDeps["executeObservation"],
): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb,
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation,
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
  };
}

describe("P-W3-01 Thought-adopted read-only inspection", () => {
  it("adopts a bounded inspection, stores evidence, and lets Thought retain an observation desk entry", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspection-adoption",
      conversationId: "thread-inspection-adoption",
      triggerKind: "owner_message",
      triggerRef: "owner-inspection-adoption",
      occupantId: "doc",
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "look into this project file",
      discordMessageIds: ["discord-inspection-adoption"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });

    const observed: Observation = {
      observationId: "observation:inspection-adoption",
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: {
        projectId: "project-ashley",
        operation: "project.read_file",
        path: "README.md",
        verified: true,
        contentUtf8: "bounded source evidence",
      },
      provenance: "sandbox-v2:project-inspection",
      dataClassification: "never_public",
      secretOmitted: false,
    };

    let modelCall = 0;
    const completeChat = vi.fn(async (messages: Array<{ role?: string; content?: unknown }>) => {
      modelCall += 1;
      if (modelCall === 1) {
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: {
              projectId: "project-ashley",
              operation: "project.read_file",
              path: "README.md",
            },
            purpose: "inspect the bounded project source relevant to the question",
            evidenceNeed: "the current README source contents",
            existingRefs: [evidence.rowId],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      }

      const userMessage = messages.find((message) => message.role === "user");
      const thoughtInput = JSON.parse(String(userMessage?.content ?? "{}")) as {
        observations?: Array<{ observationId: string }>;
      };
      const observationId = thoughtInput.observations?.[0]?.observationId;
      if (!observationId) throw new Error("inspection_observation_not_reinjected");

      return {
        text: JSON.stringify(makeSemanticSettlement({
          deskDeltas: [{
            op: "upsert",
            entry: {
              identity: { kind: "local", alias: "inspection-note" },
              concernRef: null,
              body: "The bounded project inspection was retained as evidence.",
              authorKind: "ashley",
              sourceRefs: [observationId],
              verbatim: false,
              form: "observation",
              endorsementRef: null,
              audienceScope: { kind: "owner_private" },
            },
          }],
          evidenceUse: {
            observationRefsUsed: [observationId],
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

    const executeObservation = vi.fn(async () => observed);
    const result = await runCognitiveCycle(
      sidecar,
      attentionDb,
      event,
      deps(attentionDb, completeChat, executeObservation),
    );

    expect(result).toMatchObject({
      published: true,
      acceptedSettlements: 1,
      thoughtModelAttempts: 2,
    });
    expect(executeObservation).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare(
      "SELECT observation_id FROM observations WHERE observation_id = ?",
    ).get(observed.observationId)).toEqual({ observation_id: observed.observationId });
    const desk = sidecar.prepare(
      "SELECT body, author_kind, form, source_refs_json, audience_scope_json FROM desk_entries",
    ).get() as Record<string, unknown>;
    expect(desk).toMatchObject({
      body: "The bounded project inspection was retained as evidence.",
      author_kind: "ashley",
      form: "observation",
    });
    expect(JSON.parse(String(desk.source_refs_json))).toEqual([observed.observationId]);
    expect(JSON.parse(String(desk.audience_scope_json))).toEqual({ kind: "owner_private" });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toEqual({ count: 0 });

    sidecar.close();
    attentionDb.close();
  });
});

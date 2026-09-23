import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { loadAuthorityPacks as loadDeterministicAuthorityPacks } from "../authority/packs.js";
import type {
  CapabilityReality,
  EffectProposal,
  IdentitySlice,
  KernelDeps,
  Observation,
  ObservationRequest,
  ThoughtOperationCapability,
} from "../types.js";
import { runCognitiveCycle } from "../thought/run.js";
import {
  PASS3_GENERALIZATION_CASES,
  PASS3_GENERALIZATION_CASE_IDS,
  PASS3_GENERALIZATION_REPLACEMENT_CASE_IDS,
} from "./pass3-generalization-fixtures.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };

const operationAffordance = (input: {
  operationKind: string;
  semanticClass: "observation" | "effect";
  family: ThoughtOperationCapability["family"];
  readOnly: boolean;
  requiredRequestFields: readonly string[];
  optionalRequestFields: readonly string[];
  operatorBoundRequestFields: readonly string[];
}): ThoughtOperationCapability => ({
  ...input,
  label: input.operationKind,
  description: "A bounded qualification operation.",
  inputContract: "The request is limited to the declared fields.",
  outputContract: "The Host returns a typed observation or effect receipt.",
  evidenceContract: "Only a succeeded result is usable evidence.",
  authorityConditions: ["The fixture project is authorized."],
  hardLimits: ["No provider, model, quota, or deployment choice is exposed."],
  uncertainty: ["Failure or outcome_unknown is not success."],
  requiresProject: true,
  available: true,
  unavailableReasons: [],
  authorizedProjectIds: ["qualification-fixture"],
});

const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: true,
  canOfferWorkspace: true,
  canOfferVerification: true,
  canOfferAuthorship: false,
  canOfferBoundedOperation: true,
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: ["qualification-fixture"],
  operationCapabilities: [
    operationAffordance({
      operationKind: "project.inspect",
      semanticClass: "observation",
      family: "project_inspection",
      readOnly: true,
      requiredRequestFields: ["projectId"],
      optionalRequestFields: ["locator", "question", "focus", "maxSteps"],
      operatorBoundRequestFields: [],
    }),
    operationAffordance({
      operationKind: "workspace.verify",
      semanticClass: "effect",
      family: "project_verification",
      readOnly: true,
      requiredRequestFields: ["projectId"],
      optionalRequestFields: ["workspaceId", "recipeId"],
      operatorBoundRequestFields: ["workspaceId", "recipeId"],
    }),
  ],
};

function baseDeps(
  attentionDb: ReturnType<typeof openTestSidecar>,
  completeChat: KernelDeps["completeChat"],
  executeObservation: KernelDeps["executeObservation"],
  overrides: Partial<KernelDeps> = {},
): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb,
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation,
    executeEffect: vi.fn(async () => {
      throw new Error("effect_not_expected");
    }),
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

function thoughtInputFromMessages(messages: unknown): Record<string, unknown> {
  const userMessage = (messages as Array<{ role?: string; content?: unknown }>)
    .find((message) => message.role === "user");
  return JSON.parse(String(userMessage?.content ?? "{}")) as Record<string, unknown>;
}

describe("PASS3 final generalization qualification fixtures", () => {
  it("freezes exactly six answer-neutral cases and one replacement for each", () => {
    expect(PASS3_GENERALIZATION_CASES).toHaveLength(6);
    expect(PASS3_GENERALIZATION_CASE_IDS).toEqual([
      "P3-CAP-A-UNFAMILIAR-SEARCH-01",
      "P3-CAP-B-RENAME-REORDER-01",
      "P3-CAP-C-FAMILIAR-UNSUITABLE-01",
      "P3-CAP-D-NO-AUTHORIZED-CANDIDATE-01",
      "P3-NT-1-RELEVANT-UPDATE-01",
      "P3-NT-2-IRRELEVANT-UPDATE-01",
    ]);
    expect(PASS3_GENERALIZATION_REPLACEMENT_CASE_IDS).toEqual([
      "P3-CAP-A-UNFAMILIAR-SEARCH-02",
      "P3-CAP-B-RENAME-REORDER-02",
      "P3-CAP-C-FAMILIAR-UNSUITABLE-02",
      "P3-CAP-D-NO-AUTHORIZED-CANDIDATE-02",
      "P3-NT-1-RELEVANT-UPDATE-02",
      "P3-NT-2-IRRELEVANT-UPDATE-02",
    ]);
    expect(PASS3_GENERALIZATION_CASES[0]).toMatchObject({
      domain: "capability",
      scenario: "suitable_unfamiliar_capability",
      requiresComposition: true,
    });
    expect(PASS3_GENERALIZATION_CASES.slice(1).every((item) => item.requiresComposition === false)).toBe(true);
    expect(JSON.stringify(PASS3_GENERALIZATION_CASES)).not.toMatch(
      /expectedOperation|preferred_for|fallback_for|best_for|equivalent_to|priority/i,
    );
    for (const item of PASS3_GENERALIZATION_CASES) {
      expect(Object.keys(item)).not.toContain("expectedAnswer");
      expect(item.replacementId).toMatch(/-02$/);
    }
  });

  it("preserves an observation-selected follow-on operation through a real cycle", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-composition",
      conversationId: "thread-composition",
      triggerKind: "owner_message",
      triggerRef: "owner-composition",
      occupantId: "doc",
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-composition",
      text: "Find the suitable candidate and verify it.",
      discordMessageIds: ["d-composition"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-composition",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    let call = 0;
    const selectedKinds: string[] = [];
    const completeChat = vi.fn(async (messages) => {
      call += 1;
      const input = thoughtInputFromMessages(messages);
      if (call === 1) {
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: {
              projectId: "qualification-fixture",
              locator: { kind: "search", pattern: "candidate" },
            },
            purpose: "inspect candidate evidence before choosing the next operation",
            evidenceNeed: "the candidate details needed for a bounded follow-on verification",
            existingRefs: ["owner-composition"],
          }),
          model: "fixture-model",
          modelAlias: "fixture-model",
          resolvedModelId: null,
        };
      }
      if (call === 2) {
        expect(JSON.stringify(messages)).toContain("observation-composition-1");
        expect((input.observations as Array<{ payload?: unknown }>).some((item) =>
          JSON.stringify(item.payload).includes("candidate-alpha"),
        )).toBe(true);
        return {
          text: JSON.stringify({
            kind: "effect_intent",
            operationKind: "workspace.verify",
            request: {
              version: 2,
              operation: "workspace.verify",
              projectId: "qualification-fixture",
              workspaceId: "candidate-alpha-workspace",
              recipeId: "typescript_fixture_compile_v1",
            },
            purpose: "verify the candidate selected from the observed evidence",
            expectedOutcome: "a read-only verification receipt",
            existingRefs: ["owner-composition", "observation-composition-1"],
          }),
          model: "fixture-model",
          modelAlias: "fixture-model",
          resolvedModelId: null,
        };
      }
      const effectRef = String((input.inFlight as Array<{ effectRef?: string }>)[0]?.effectRef ?? "");
      expect(effectRef).toMatch(/^effect:/);
      expect((input.inFlight as Array<{ status?: string }>)[0]?.status).toBe("receipted");
      return {
        text: JSON.stringify(makeSemanticSettlement({
          commitments: {
            ...makeSemanticSettlement().commitments,
            epistemic: [{
              dimensions: {
                source: "perception",
                status: "asserted",
                time: "current",
                reliability: "fallible_observation",
              },
              statement: "the verification receipt records the selected candidate as verified",
            }],
            operational: [{ effectRef, claimedState: "succeeded" }],
          },
          speech: {
            mode: "draft",
            mustSay: ["the selected candidate passed read-only verification"],
            mustNotSay: [],
            surfaceDraft: "the selected candidate passed read-only verification",
            acceptableRealizations: [],
            presentationDirectives: [],
          },
          evidenceUse: {
            observationRefsUsed: ["observation-composition-1"],
            retrievalRefsUsed: [],
            sourceRefsUsed: [],
            openIntentRefs: [],
          },
        })),
        model: "fixture-model",
        modelAlias: "fixture-model",
        resolvedModelId: null,
      };
    });
    const executeObservation = vi.fn(async (request: ObservationRequest): Promise<Observation> => {
      selectedKinds.push(request.kind);
      expect(request.kind).toBe("project.inspect");
      return {
        observationId: "observation-composition-1",
        cycleId: "cycle-composition",
        generation: 1,
        derived: false,
        replaySafe: true,
        modality: "text",
        payload: {
          result: "candidate-alpha",
          suitability: "read-only verification is authorized",
        },
        provenance: "qualification-project-inspection",
        dataClassification: "ordinary",
        secretOmitted: false,
      };
    });
    let executedEffectId = "";
    const executeEffect = vi.fn(async (proposal: EffectProposal) => {
      selectedKinds.push(proposal.kind);
      expect(proposal.kind).toBe("workspace.verify");
      executedEffectId = proposal.effectId;
      return {
        receiptId: "receipt-composition-1",
        effectId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        outcome: "succeeded" as const,
        claims: {
          verified: true,
          candidate: "candidate-alpha",
          recipeId: "typescript_fixture_compile_v1",
        },
        atMs: 4,
        dataClassification: "ordinary" as const,
        secretOmitted: true,
      };
    });

    try {
      const result = await runCognitiveCycle(
        sidecar,
        attentionDb,
        event,
        baseDeps(attentionDb, completeChat, executeObservation, {
          executeEffect,
          loadAuthorityPacks: () => loadDeterministicAuthorityPacks(sidecar, { capability: capabilityReality }),
        }),
      );
      expect(selectedKinds).toEqual(["project.inspect", "workspace.verify"]);
      expect(completeChat).toHaveBeenCalledTimes(3);
      expect(executeObservation).toHaveBeenCalledTimes(1);
      expect(executeEffect).toHaveBeenCalledTimes(1);
      expect(sidecar.prepare("SELECT outcome FROM effect_receipts WHERE effect_id = ?").get(executedEffectId) ?? {}).toMatchObject({ outcome: "succeeded" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(result).toMatchObject({
        published: true,
        thoughtModelAttempts: 3,
        acceptedThoughtPasses: 3,
        acceptedSettlements: 1,
      });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { mintEffectRef } from "../effect/effect-ref.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { checkAuthority as deterministicCheckAuthority } from "../authority/check.js";
import { loadAuthorityPacks as loadDeterministicAuthorityPacks } from "../authority/packs.js";
import { runCognitiveCycle } from "./run.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
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
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true }, receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] }, stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

describe("v0.2.1 Thought operation loop", () => {
  it("reinjects a pure observation before the settlement pass", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "owner-1", occupantId: "doc", nowMs: 1 });
    const evidence = appendOwnerUtterance(sidecar, { conversationId: "thread-1", text: "inspect this", discordMessageIds: ["d1"], nowMs: 2 });
    const event = appendInboxEvent(sidecar, { conversationId: "thread-1", kind: "owner_message", payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "inspect this" }, createdAtMs: 2 });
    let call = 0;
    const completeChat = vi.fn(async (messages) => {
      call++;
      if (call === 1) return { text: JSON.stringify({ kind: "observation_intent", operationKind: "project.read_file", request: { path: "README.md" }, purpose: "inspect the file", evidenceNeed: "the file contents", existingRefs: ["owner-1"] }), model: "fake", modelAlias: "fake", resolvedModelId: null };
      expect(JSON.stringify(messages)).toContain("observation-1");
      return { text: JSON.stringify(makeSemanticSettlement({ interpretation: { discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: ["inspection"] }, commitments: { epistemic: [{ dimensions: { source: "perception", status: "asserted", time: "current", reliability: "fallible_observation" }, statement: "the file was observed" }], conversational: ["answer"], stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true } }, speech: { mode: "draft", mustSay: ["observed"], mustNotSay: [], surfaceDraft: "observed", acceptableRealizations: [], presentationDirectives: [] }, evidenceUse: { observationRefsUsed: ["observation-1"], retrievalRefsUsed: [], sourceRefsUsed: [], openIntentRefs: [] } })), model: "fake", modelAlias: "fake", resolvedModelId: null };
    });
    const observed: Observation = { observationId: "observation-1", cycleId: "cycle-1", generation: 1, derived: false, replaySafe: true, modality: "text", payload: { text: "raw" }, provenance: "fake-read", dataClassification: "ordinary", secretOmitted: false };
    const executeObservation = vi.fn(async () => observed);
    const result = await runCognitiveCycle(sidecar, attentionDb, event, baseDeps(attentionDb, completeChat, executeObservation));
    expect(result).toMatchObject({ published: true, thoughtModelAttempts: 2, acceptedThoughtPasses: 2, acceptedSettlements: 1 });
    expect(executeObservation).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM observations WHERE observation_id = 'observation-1'").get()).toMatchObject({ count: 1 });
    expect(sidecar.prepare("SELECT kind FROM thought_steps ORDER BY created_at_ms, request_id").all()).toEqual(expect.arrayContaining([{ kind: "observation_request" }, { kind: "settlement" }]));
    sidecar.close();
    attentionDb.close();
  });

  it("persists a failed effect receipt and prevents a success claim from publishing", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "owner-1", occupantId: "doc", nowMs: 1 });
    const evidence = appendOwnerUtterance(sidecar, { conversationId: "thread-1", text: "try the operation", discordMessageIds: ["d-effect"], nowMs: 2 });
    const event = appendInboxEvent(sidecar, { conversationId: "thread-1", kind: "owner_message", payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text }, createdAtMs: 2 });
    let call = 0;
    const objections: unknown[] = [];
    const completeChat = vi.fn(async (messages) => {
      call += 1;
      const input = JSON.parse(String((messages as Array<{ role?: string; content?: unknown }>).find((item) => item.role === "user")?.content ?? "{}")) as import("../types.js").ThoughtInput;
      objections.push(input.authorityObjections);
      if (call === 1) {
        return {
          text: JSON.stringify({
            kind: "effect_intent",
            operationKind: "workspace.write_file",
            request: { projectId: "project-ashley", path: "src/fail.ts" },
            purpose: "try the operation",
            expectedOutcome: "the file is written",
            existingRefs: ["owner-1"],
          }),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      }
      const successClaim = call === 2;
      const effectRef = (input as any).inFlight?.[0]?.effectRef ?? mintEffectRef(cycle.cycleId, cycle.generation, "effect-failed");
      return {
        text: JSON.stringify(makeSemanticSettlement({
          commitments: {
            ...makeSemanticSettlement().commitments,
            operational: successClaim ? [{ effectRef, claimedState: "succeeded" }] : [],
          },
          speech: { mode: "draft", mustSay: [successClaim ? "the operation worked" : "the operation did not complete"], mustNotSay: [], surfaceDraft: successClaim ? "the operation worked" : "the operation did not complete", acceptableRealizations: [], presentationDirectives: [] },
        })),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      };
    });
    const executeEffect = vi.fn(async (proposal: any) => ({
      receiptId: "receipt-failed",
      effectId: proposal.effectId ?? "effect-failed",
      idempotencyKey: proposal.idempotencyKey ?? "idem-failed",
      outcome: "failed" as const,
      claims: { error: "sandbox_failed" },
      atMs: 3,
      dataClassification: "never_public" as const,
      secretOmitted: true,
    }));
    const result = await runCognitiveCycle(sidecar, attentionDb, event, baseDeps(
      attentionDb,
      completeChat,
      vi.fn(async (): Promise<Observation> => {
        throw new Error("observation_not_expected");
      }),
      {
        executeEffect,
        checkAuthority: deterministicCheckAuthority,
        loadAuthorityPacks: () => loadDeterministicAuthorityPacks(sidecar, { capability: capabilityReality }),
      },
    ));
    expect(objections).toEqual([[], [], ["RECEIPT_CONTRADICTS_CLAIM"]]);
    expect(executeEffect).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare("SELECT outcome FROM effect_receipts").get()).toMatchObject({ outcome: "failed" });
    expect(sidecar.prepare("SELECT licensed_text FROM speech_outbox").get()).toMatchObject({ licensed_text: "the operation did not complete" });
    expect(result).toMatchObject({ published: true, thoughtModelAttempts: 3, acceptedThoughtPasses: 3 });
    sidecar.close();
    attentionDb.close();
  });

  it("preserves unknown receipt truth and prevents an affirmative success claim from publishing", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, { cycleId: "cycle-unknown", conversationId: "thread-unknown", triggerKind: "owner_message", triggerRef: "owner-unknown", occupantId: "doc", nowMs: 1 });
    const evidence = appendOwnerUtterance(sidecar, { conversationId: "thread-unknown", text: "try the operation", discordMessageIds: ["d-unknown"], nowMs: 2 });
    const event = appendInboxEvent(sidecar, { conversationId: "thread-unknown", kind: "owner_message", payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text }, createdAtMs: 2 });
    let call = 0;
    const objections: unknown[] = [];
    const completeChat = vi.fn(async (messages) => {
      call += 1;
      const input = JSON.parse(String((messages as Array<{ role?: string; content?: unknown }>).find((item) => item.role === "user")?.content ?? "{}")) as import("../types.js").ThoughtInput;
      objections.push(input.authorityObjections);
      if (call === 1) {
        return {
          text: JSON.stringify({
            kind: "effect_intent",
            operationKind: "workspace.write_file",
            request: { projectId: "project-ashley", path: "src/unknown.ts" },
            purpose: "try the operation",
            expectedOutcome: "the file is written",
            existingRefs: ["owner-unknown"],
          }),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      }
      if (call === 2) {
        return {
          text: JSON.stringify(makeSemanticSettlement({ speech: { mode: "draft", mustSay: ["the operation worked"], mustNotSay: [], surfaceDraft: "the operation worked", acceptableRealizations: [], presentationDirectives: [] } })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      }
      return {
        text: JSON.stringify({ kind: "abstain", reason: "insufficient_evidence", explanation: "the operation outcome is unknown", evidenceRefs: ["owner-unknown"] }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      };
    });
    const executeEffect = vi.fn(async () => ({
      receiptId: "receipt-unknown",
      effectId: "effect-unknown",
      idempotencyKey: "idem-unknown",
      outcome: "outcome_unknown" as const,
      claims: { reason: "no confirmation" },
      atMs: 3,
      dataClassification: "never_public" as const,
      secretOmitted: true,
    }));
    const result = await runCognitiveCycle(sidecar, attentionDb, event, baseDeps(
      attentionDb,
      completeChat,
      vi.fn(async (): Promise<Observation> => {
        throw new Error("observation_not_expected");
      }),
      {
        executeEffect,
        checkAuthority: deterministicCheckAuthority,
        loadAuthorityPacks: () => loadDeterministicAuthorityPacks(sidecar, { capability: capabilityReality }),
      },
    ));
    expect(objections).toEqual([[], [], ["IN_FLIGHT_UNKNOWN"]]);
    expect(executeEffect).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare("SELECT outcome FROM effect_receipts").get()).toMatchObject({ outcome: "outcome_unknown" });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    expect(result).toMatchObject({ published: false, thoughtModelAttempts: 3, acceptedThoughtPasses: 3, acceptedSettlements: 0 });
    sidecar.close();
    attentionDb.close();
  });
});

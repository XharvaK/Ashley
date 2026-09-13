import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { runCognitiveCycle } from "../thought/run.js";
import { THOUGHT_UNAVAILABLE_NOTICE } from "../speech/infrastructure-notice.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function baseDeps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
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
    projectSystemNotice: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

function eventFixture(sidecar: ReturnType<typeof openTestSidecar>) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: "cycle-speech",
    conversationId: "thread-speech",
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: "thread-speech",
    text: "hello",
    discordMessageIds: ["discord-owner-1"],
    nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    conversationId: "thread-speech",
    kind: "owner_message",
    payload: {
      cycleId: cycle.cycleId,
      evidenceRowId: evidence.rowId,
      ownerMessage: "hello",
      ownerId: "doc",
      channel: "discord",
      threadId: "thread-speech",
    },
    createdAtMs: 2,
  });
  return event;
}

function validThought(surfaceDraft: string) {
  return makeSemanticSettlement({
    interpretation: { discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: ["hello"] },
    commitments: {
      epistemic: [{ dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, statement: "hello" }],
      conversational: ["answer"], stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
    },
    speech: { mode: "draft", mustSay: ["hello"], mustNotSay: [], surfaceDraft, acceptableRealizations: [surfaceDraft], presentationDirectives: [] },
  });
}

describe("v0.2.1 speech and failure scenarios", () => {
  it("licenses rendered Thought text before publication and skips Expression by default", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const completeChat = vi.fn(async () => ({ text: JSON.stringify(validThought("hello [[gif:cat]]")), model: "fake", modelAlias: "fake", resolvedModelId: null }));
    const projectOutbox = vi.fn(async () => undefined);
    const result = await runCognitiveCycle(sidecar, attentionDb, eventFixture(sidecar), baseDeps({ attentionDb, completeChat, projectOutbox }));
    expect(result).toMatchObject({ published: true, acceptedSettlements: 1 });
    expect(sidecar.prepare("SELECT json_extract(payload_json, '$.speech.finalLicensedText') AS text FROM settlements").get()).toMatchObject({ text: "hello" });
    expect(sidecar.prepare("SELECT licensed_text FROM speech_outbox").get()).toMatchObject({ licensed_text: "hello" });
    expect(projectOutbox).toHaveBeenCalledTimes(1);
    sidecar.close();
    attentionDb.close();
  });

  it("uses a persisted system notice for unavailable Thought", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const projectSystemNotice = vi.fn(async () => undefined);
    const result = await runCognitiveCycle(sidecar, attentionDb, eventFixture(sidecar), baseDeps({
      attentionDb,
      completeChat: vi.fn(async () => { throw new Error("provider_down"); }),
      projectSystemNotice,
    }));
    expect(result.published).toBe(false);
    expect(projectSystemNotice).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    expect(sidecar.prepare("SELECT notice_text, send_status FROM system_notice_outbox").get()).toMatchObject({
      notice_text: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN`,
      send_status: "pending",
    });
    expect(sidecar.prepare("SELECT thought_unavailable FROM causal_ledger WHERE cycle_id = 'cycle-speech'").get()).toMatchObject({ thought_unavailable: 1 });
    sidecar.close();
    attentionDb.close();
  });
});

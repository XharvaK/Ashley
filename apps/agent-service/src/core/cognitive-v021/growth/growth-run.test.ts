import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { readIdentitySlice } from "../identity/constitution.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { recordMemoryFormation } from "../memory/strength.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, KernelDeps } from "../types.js";
import { runCognitiveCycle } from "../thought/run.js";
import { readMood } from "./mood.js";
import { listOpenExpectations } from "./expectations.js";
import { listCurrentOpinions } from "./revisions.js";

const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};
const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };
const NOW = Date.UTC(2026, 9, 1, 12, 0);

function deps(nuclear: DatabaseSync, overrides: Partial<KernelDeps>): KernelDeps {
  return {
    nowMs: () => NOW,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async () => []),
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
    constitution: { constitutional: [], stableSelf: [] },
    readConstitution: () => readIdentitySlice(nuclear, "doc"),
    identityOwnerId: "doc",
    capabilityReality,
    ...overrides,
  };
}

function ownerTurn(sidecar: DatabaseSync, conversationId: string, ref: string, text: string, nowMs: number) {
  const cycle = admitTestCycle(sidecar, { conversationId, triggerKind: "owner_message", triggerRef: ref, occupantId: "doc", authorityEpoch: 1, nowMs });
  const message = appendOwnerUtterance(sidecar, { conversationId, text, nowMs, audienceAtCapture: "owner_private" });
  return appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId,
    kind: "owner_utterance",
    payload: { cycleId: cycle.cycleId, evidenceRowId: message.rowId, ownerId: "doc", ownerMessage: message.text },
    createdAtMs: nowMs,
  });
}

describe("Growth V1 G4 through the kernel", () => {
  it("shows Ashley her growth, records what she authors, and applies an earned opinion", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-growth-run";
    for (const [key, statement] of [["self:g1", "I light up talking about Basic Channel."], ["self:g2", "Music history threads are my favourite."]] as const) {
      upsertMemoryAssertion(sidecar, { assertionKey: key, statement, memoryKind: "learned_self_evidence", dimensions, dataClassification: "ordinary", lineageParentKey: null, admittedGeneration: 1, live: true });
      recordMemoryFormation(sidecar, { assertionKey: key, salience: 0.7, nowMs: NOW - 60_000 });
    }
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement({
        speech: { mode: "draft", surfaceDraft: "Good luck with the interview." },
        commitments: { conversational: ["acknowledge"] },
        growth: {
          appraisal: { note: "Doc trusting me with the interview nerves moved me.", valence: 0.5, openness: 0.2 },
          expectations: ["Doc will tell me how the interview went on Friday."],
          revisions: [{ layer: "opinion", topic: "music history", text: "Music history is the best way into a genre.", rationale: "It keeps being what I reach for.", evidenceRefs: ["self:g1", "self:g2"] }],
        },
      })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const run = await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m1", "interview on Friday, nervous", NOW), deps(nuclear, { completeChat }));
      expect(run.outboxId).not.toBeNull();

      const request = JSON.stringify(completeChat.mock.calls[0]?.[0]);
      expect(request).toContain("growth (Owner-private) is how you grow");
      expect(request).toContain('\\"growth\\"');
      // She sees her revisable identity by entry id, from the live nuclear store.
      expect(request).toContain("comfortable with uncertainty");

      expect(readMood(sidecar, NOW)).toMatchObject({ valence: 0.3, openness: 0.7, reason: "Doc trusting me with the interview nerves moved me." });
      expect(listOpenExpectations(sidecar, NOW).map((item) => item.statement)).toEqual(["Doc will tell me how the interview went on Friday."]);
      expect(listCurrentOpinions(sidecar).map((item) => item.proposedText)).toEqual(["Music history is the best way into a genre."]);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reads identity fresh for each cycle, so an applied revision reaches the next Thought", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-growth-identity";
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement({ speech: { mode: "draft", surfaceDraft: "Hi." }, commitments: { conversational: ["acknowledge"] } })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      readIdentitySlice(nuclear, "doc");
      await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m1", "hello", NOW), deps(nuclear, { completeChat }));
      const trait = nuclear.prepare("SELECT id FROM identity_entries WHERE kind = 'trait'").get() as { id: number };
      const at = new Date(NOW).toISOString();
      nuclear.prepare(
        "INSERT INTO identity_entries (owner_id, layer, kind, text, source, revised_from, created_at, updated_at) VALUES ('doc', 'stable', 'trait', 'patient with messy problems', 'organic', ?, ?, ?)",
      ).run(trait.id, at, at);
      await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m2", "hello again", NOW + 60_000), deps(nuclear, { completeChat, nowMs: () => NOW + 60_000 }));
      expect(JSON.stringify(completeChat.mock.calls[0]?.[0])).not.toContain("patient with messy problems");
      expect(JSON.stringify(completeChat.mock.calls.at(-1)?.[0])).toContain("patient with messy problems");
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

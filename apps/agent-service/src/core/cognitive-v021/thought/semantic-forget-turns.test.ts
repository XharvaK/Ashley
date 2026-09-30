import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { openNuclearDb } from "../../db.js";
import { openContinuityDb } from "../../continuity/db.js";
import { registerContinuityFor } from "../../continuity/registry.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { runCognitiveCycle } from "./run.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";

const OWNER = "owner-forget-turns";
const THREAD = "thread-forget-turns";
const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function deps(nowMs: number, overrides: Partial<KernelDeps>): KernelDeps {
  return {
    nowMs: () => nowMs,
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

function ownerTurn(sidecar: DatabaseSync, cycleId: string, text: string, atMs: number) {
  const cycle = admitTestCycle(sidecar, {
    cycleId,
    conversationId: THREAD,
    triggerKind: "owner_message",
    triggerRef: `${cycleId}-ref`,
    occupantId: OWNER,
    authorityEpoch: 1,
    nowMs: atMs,
  });
  const evidence = appendOwnerUtterance(sidecar, { conversationId: THREAD, text, discordMessageIds: [`${cycleId}-msg`], nowMs: atMs });
  return appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId: THREAD,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text, ownerId: OWNER },
    createdAtMs: atMs,
  });
}

function settlementWith(forget: unknown, say: string) {
  return {
    ...makeSemanticSettlement({ speech: { mode: "draft", mustSay: [], surfaceDraft: say } }),
    forget,
  };
}

const originalOwner = env.discordOwnerId;
afterEach(() => { env.discordOwnerId = originalOwner; });

describe("A2 semantic forgetting through Thought turns", () => {
  it("proposes on the Owner's ask, shows the proposal next turn, and erases on the Owner's yes", async () => {
    env.discordOwnerId = OWNER;
    const sidecar = openTestSidecar();
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    registerContinuityFor(nuclear, continuity);
    try {
      const sister = appendOwnerUtterance(sidecar, { conversationId: THREAD, text: "My sister Mara is moving to Lisbon.", nowMs: 5 });
      upsertMemoryAssertion(sidecar, {
        assertionKey: "owner:sister-move",
        statement: "Alex's sister is relocating abroad.",
        memoryKind: "owner_world_claim",
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      const ask = ownerTurn(sidecar, "cycle-forget-ask", "Please forget everything about my sister's move.", 90);
      const propose = vi.fn(async () => ({
        text: JSON.stringify(settlementWith(
          { action: "propose", phrases: ["Mara"], recordRefs: ["owner:sister-move"] },
          "That covers what you told me about your sister's move and my memory of it. Shall I forget it?",
        )),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      }));
      const first = await runCognitiveCycle(sidecar, nuclear, ask, deps(100, { completeChat: propose }));
      expect(first.published).toBe(true);
      const proposal = sidecar.prepare("SELECT proposal_id, status FROM forget_proposals").get() as { proposal_id: string; status: string };
      expect(proposal.status).toBe("pending");
      expect(sidecar.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(sister.rowId))
        .toMatchObject({ text: "My sister Mara is moving to Lisbon." });

      const yes = ownerTurn(sidecar, "cycle-forget-yes", "Yes, forget it.", 150);
      let sawProposal = false;
      const confirm = vi.fn(async (messages: Array<{ content: unknown }>) => {
        sawProposal = messages.some((message) => String(message.content).includes(proposal.proposal_id));
        return {
          text: JSON.stringify(settlementWith({ action: "confirm", proposalId: proposal.proposal_id }, "Done. It's gone.")),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      });
      const second = await runCognitiveCycle(sidecar, nuclear, yes, deps(200, { completeChat: confirm as never }));
      expect(second.published).toBe(true);
      expect(sawProposal).toBe(true);
      expect(sidecar.prepare("SELECT status FROM forget_proposals").get()).toMatchObject({ status: "confirmed" });
      expect(sidecar.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(sister.rowId)).toMatchObject({ text: null });
      expect(sidecar.prepare("SELECT live FROM sidecar_memory_assertions WHERE assertion_key = 'owner:sister-move'").get())
        .toMatchObject({ live: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
      continuity.close();
    }
  });

  it("never offers the forget field outside an Owner chat turn", async () => {
    const { constrainThoughtOutputSchema, thoughtContractProfile } = await import("./output-contract.js");
    const namespace = { allowedOperationalEffectRefs: [], fingerprint: "none" } as never;
    const fields = (source: Parameters<typeof thoughtContractProfile>[0]) => Object.keys(
      ((constrainThoughtOutputSchema(namespace, thoughtContractProfile(source)).schema as { oneOf: Array<{ properties: object }> }).oneOf[0]!).properties,
    );
    const chat = { trigger: { kind: "owner_message" }, capabilityReality };
    expect(fields(chat)).toContain("forget");
    expect(fields({ ...chat, audience: { kind: "room" } })).not.toContain("forget");
    expect(fields({ trigger: { kind: "idle_opportunity" }, innerPass: { kind: "afterglow" } })).not.toContain("forget");
  });
});

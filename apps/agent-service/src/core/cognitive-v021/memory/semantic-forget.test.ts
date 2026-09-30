import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openContinuityDb } from "../../continuity/db.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { upsertMemoryAssertion } from "./assertions.js";
import { recordEpisode } from "./episodes.js";
import { readForgetEpoch } from "./forget-epoch.js";
import {
  applySemanticForget,
  expireForgetProposals,
  isValidForgetClaim,
  pendingForgetsForThought,
  FORGET_PROPOSAL_TTL_MS,
  type SemanticForgetContext,
} from "./semantic-forget.js";

const OWNER = "owner-semantic-forget";
const THREAD = "thread-semantic-forget";

function stores() {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
  return { sidecar, nuclear, continuity };
}

type Stores = ReturnType<typeof stores>;

function context(s: Stores, overrides: Partial<SemanticForgetContext> = {}): SemanticForgetContext {
  return {
    sidecar: s.sidecar,
    nuclear: s.nuclear,
    continuity: s.continuity,
    ownerId: OWNER,
    conversationId: THREAD,
    settlementId: "settlement-propose",
    triggerCreatedAtMs: 100,
    ownerTurn: true,
    nowMs: 100,
    ...overrides,
  };
}

function seed(s: Stores) {
  const sister = appendOwnerUtterance(s.sidecar, { conversationId: THREAD, text: "My sister Mara is moving to Lisbon.", nowMs: 10 });
  const unrelated = appendOwnerUtterance(s.sidecar, { conversationId: THREAD, text: "I had pasta for lunch.", nowMs: 11 });
  upsertMemoryAssertion(s.sidecar, {
    assertionKey: "owner:sister-move",
    statement: "Alex's sister is relocating abroad.",
    memoryKind: "owner_world_claim",
    dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
  });
  const episode = recordEpisode(s.sidecar, {
    conversationId: THREAD,
    cycleId: "cycle-episode",
    rows: [{ rowId: unrelated.rowId, createdAtMs: 11, dataClassification: "ordinary" }],
    reflection: { summary: "A quiet lunch chat.", salience: 0.4 },
    nowMs: 12,
  });
  s.sidecar.prepare(
    "INSERT INTO growth_revision_evidence (revision_id, evidence_ref, cited_cycle_id, linked_at_ms) VALUES (7, 'owner:sister-move', 'cycle-growth', 13)",
  ).run();
  return { sister, unrelated, episode: episode! };
}

describe("A2 semantic forgetting", () => {
  it("accepts only well-formed forget claims", () => {
    expect(isValidForgetClaim({ action: "propose", phrases: ["Mara"] })).toBe(true);
    expect(isValidForgetClaim({ action: "propose", phrases: ["Mara"], recordRefs: ["owner:sister-move"] })).toBe(true);
    expect(isValidForgetClaim({ action: "confirm", proposalId: "p-1" })).toBe(true);
    expect(isValidForgetClaim({ action: "cancel", proposalId: "p-1" })).toBe(true);
    expect(isValidForgetClaim({ action: "propose", phrases: [] })).toBe(false);
    expect(isValidForgetClaim({ action: "propose", phrases: ["x"] })).toBe(false);
    expect(isValidForgetClaim({ action: "propose", phrases: ["Mara"], recordRefs: [] })).toBe(false);
    expect(isValidForgetClaim({ action: "confirm" })).toBe(false);
    expect(isValidForgetClaim({ action: "erase", proposalId: "p-1" })).toBe(false);
    expect(isValidForgetClaim({ action: "confirm", proposalId: "p-1", topic: "Mara" })).toBe(false);
  });

  it("proposes a forget covering the phrases, the cited records and what derives from them, and erases nothing yet", () => {
    const s = stores();
    try {
      const { episode } = seed(s);
      const outcome = applySemanticForget(context(s), {
        action: "propose",
        phrases: ["Mara"],
        recordRefs: ["owner:sister-move", episode.episodeId, "not-a-record"],
      });
      expect(outcome.kind).toBe("proposed");
      if (outcome.kind !== "proposed") return;
      expect(outcome.categoryCounts).toEqual(expect.objectContaining({
        v021_conversation_evidence: 1,
        v021_memory_assertion: 1,
        v021_episode: 1,
        v021_growth_revision: 1,
      }));
      expect(s.sidecar.prepare("SELECT COUNT(*) AS n FROM conversation_evidence_log WHERE text IS NULL").get()).toMatchObject({ n: 0 });
      expect(pendingForgetsForThought(s.sidecar, THREAD, 100)).toEqual([
        expect.objectContaining({ proposalId: outcome.proposalId, covers: outcome.categoryCounts }),
      ]);
      // Replaying the same settlement finds its proposal instead of making another.
      expect(applySemanticForget(context(s), { action: "propose", phrases: ["Mara"] })).toMatchObject({ proposalId: outcome.proposalId });
      expect(s.sidecar.prepare("SELECT COUNT(*) AS n FROM forget_proposals").get()).toMatchObject({ n: 1 });
    } finally {
      s.sidecar.close(); s.nuclear.close(); s.continuity.close();
    }
  });

  it("erases on the Owner's later yes, sweeps rows written after the plan, and moves the forget epoch", () => {
    const s = stores();
    try {
      const { sister, unrelated } = seed(s);
      const proposed = applySemanticForget(context(s), { action: "propose", phrases: ["Mara"], recordRefs: ["owner:sister-move"] });
      if (proposed.kind !== "proposed") throw new Error("expected proposal");
      // Her reply naming it is written on receipt, after the plan.
      const reply = appendAshleyEvidence(s.sidecar, { conversationId: THREAD, text: "You want me to forget Mara's move, yes?", nowMs: 101 });
      const epoch = readForgetEpoch(s.sidecar);

      const confirmed = applySemanticForget(context(s, { settlementId: "settlement-confirm", triggerCreatedAtMs: 150, nowMs: 150 }), {
        action: "confirm",
        proposalId: proposed.proposalId,
      });
      expect(confirmed).toMatchObject({ kind: "confirmed", proposalId: proposed.proposalId });
      const text = (rowId: string) => (s.sidecar.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(rowId) as { text: string | null }).text;
      expect(text(sister.rowId)).toBeNull();
      expect(text(reply.rowId)).toBeNull();
      expect(text(unrelated.rowId)).toBe("I had pasta for lunch.");
      expect(s.sidecar.prepare("SELECT live FROM sidecar_memory_assertions WHERE assertion_key = 'owner:sister-move'").get()).toMatchObject({ live: 0 });
      expect(readForgetEpoch(s.sidecar)).toBeGreaterThan(epoch);
      expect(s.sidecar.prepare("SELECT status, phrases_json FROM forget_proposals WHERE proposal_id = ?").get(proposed.proposalId))
        .toMatchObject({ status: "confirmed", phrases_json: null });
      expect(pendingForgetsForThought(s.sidecar, THREAD, 150)).toEqual([]);
      // A replay of the confirming settlement is a no-op.
      expect(applySemanticForget(context(s, { settlementId: "settlement-confirm", triggerCreatedAtMs: 150, nowMs: 150 }), {
        action: "confirm", proposalId: proposed.proposalId,
      })).toMatchObject({ kind: "confirmed" });
    } finally {
      s.sidecar.close(); s.nuclear.close(); s.continuity.close();
    }
  });

  it("refuses a confirm without a later Owner message, from another conversation, a room, or a non-Owner turn", () => {
    const s = stores();
    try {
      const { sister } = seed(s);
      const proposed = applySemanticForget(context(s), { action: "propose", phrases: ["Mara"] });
      if (proposed.kind !== "proposed") throw new Error("expected proposal");
      const confirm = { action: "confirm" as const, proposalId: proposed.proposalId };
      expect(applySemanticForget(context(s, { settlementId: "s2", triggerCreatedAtMs: 100 }), confirm))
        .toEqual({ kind: "refused", reason: "no_owner_answer_after_proposal" });
      expect(applySemanticForget(context(s, { settlementId: "s3", triggerCreatedAtMs: 150, conversationId: "thread-other" }), confirm))
        .toEqual({ kind: "refused", reason: "other_conversation" });
      expect(applySemanticForget(context(s, { settlementId: "s4", triggerCreatedAtMs: 150, conversationId: "room:g:c" }), confirm))
        .toEqual({ kind: "refused", reason: "not_owner_private" });
      expect(applySemanticForget(context(s, { settlementId: "s5", triggerCreatedAtMs: 150, ownerTurn: false }), confirm))
        .toEqual({ kind: "refused", reason: "not_owner_turn" });
      expect(applySemanticForget(context(s, { settlementId: "s6", triggerCreatedAtMs: 150, nowMs: 100 + FORGET_PROPOSAL_TTL_MS }), confirm))
        .toEqual({ kind: "refused", reason: "proposal_expired" });
      expect(s.sidecar.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(sister.rowId))
        .toMatchObject({ text: "My sister Mara is moving to Lisbon." });
    } finally {
      s.sidecar.close(); s.nuclear.close(); s.continuity.close();
    }
  });

  it("drops the phrases when the Owner declines or never answers, and erases nothing", () => {
    const s = stores();
    try {
      const { sister } = seed(s);
      const first = applySemanticForget(context(s), { action: "propose", phrases: ["Mara"] });
      const second = applySemanticForget(context(s, { settlementId: "settlement-second", nowMs: 200 }), { action: "propose", phrases: ["Lisbon"] });
      if (first.kind !== "proposed" || second.kind !== "proposed") throw new Error("expected proposals");
      expect(applySemanticForget(context(s, { settlementId: "settlement-cancel", triggerCreatedAtMs: 300, nowMs: 300 }), {
        action: "cancel", proposalId: first.proposalId,
      })).toEqual({ kind: "cancelled", proposalId: first.proposalId });
      expect(s.sidecar.prepare("SELECT status, phrases_json FROM forget_proposals WHERE proposal_id = ?").get(first.proposalId))
        .toMatchObject({ status: "cancelled", phrases_json: null });
      expect(expireForgetProposals(s.sidecar, 200 + FORGET_PROPOSAL_TTL_MS)).toBe(1);
      expect(s.sidecar.prepare("SELECT phrases_json FROM forget_proposals WHERE proposal_id = ?").get(second.proposalId))
        .toMatchObject({ phrases_json: null });
      expect(s.sidecar.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(sister.rowId))
        .toMatchObject({ text: "My sister Mara is moving to Lisbon." });
    } finally {
      s.sidecar.close(); s.nuclear.close(); s.continuity.close();
    }
  });

  it("reports nothing found rather than an empty proposal", () => {
    const s = stores();
    try {
      seed(s);
      expect(applySemanticForget(context(s), { action: "propose", phrases: ["Zanzibar"] })).toEqual({ kind: "nothing_found" });
      expect(s.sidecar.prepare("SELECT COUNT(*) AS n FROM forget_proposals").get()).toMatchObject({ n: 0 });
    } finally {
      s.sidecar.close(); s.nuclear.close(); s.continuity.close();
    }
  });
});

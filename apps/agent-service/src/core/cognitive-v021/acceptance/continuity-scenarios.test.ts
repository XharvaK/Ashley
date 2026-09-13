import { describe, expect, it } from "vitest";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { buildThoughtInput } from "../thought/input.js";
import { listWorkingContext } from "../evidence/working-context.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import type { CapabilityReality, IdentitySlice } from "../types.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { continuitySettlement, perturbedContinuitySettlement } from "./continuity-fixtures.js";

const constitution: IdentitySlice = { constitutional: ["truth before performance"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

describe("v0.2.1 causal continuity scenarios", () => {
  it.each(["HY3", "Qwen"]) ("preserves %s corrections and owner teaching in WC", (entity) => {
    const db = openTestSidecar();
    try {
      const first = admitTestCycle(db, { cycleId: `cycle-${entity}-1`, conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "turn-1", occupantId: "doc", nowMs: 1 });
      const mention = appendOwnerUtterance(db, { conversationId: "thread-1", text: entity === "HY3" ? "HY4" : "Alpha", discordMessageIds: [`${entity}-1`], nowMs: 2 });
      expect(publishSemanticTransaction(db, continuitySettlement({
        settlementId: `settlement-${entity}-1`, cycleId: first.cycleId, generation: first.generation,
        triggerRef: mention.rowId,
        interpretation: { ...continuitySettlement().interpretation, referentBindings: [{ span: entity === "HY3" ? "HY4" : "Alpha", entityKey: entity, sourceTurnIds: [mention.rowId] }] },
      }))).toMatchObject({ published: true });
      const second = admitTestCycle(db, { cycleId: `cycle-${entity}-2`, conversationId: "thread-1", generation: 2, triggerKind: "owner_message", triggerRef: "turn-2", occupantId: "doc", nowMs: 3 });
      const correction = appendOwnerUtterance(db, { conversationId: "thread-1", text: entity === "HY3" ? "I meant HY3" : "I meant Beta", discordMessageIds: [`${entity}-2`], nowMs: 4 });
      const oldId = entity === "HY3" ? `wc-${entity}-old` : "wc-Qwen-old";
      const newEntity = entity === "HY3" ? "HY3" : "Beta";
      expect(publishSemanticTransaction(db, continuitySettlement({
        settlementId: `settlement-${entity}-2`, cycleId: second.cycleId, generation: 2, triggerRef: correction.rowId,
        interpretation: { ...continuitySettlement().interpretation, corrections: [{ correctedTurnIds: [mention.rowId], fromSpan: entity === "HY3" ? "HY4" : "Alpha", toSpan: newEntity, concernId: "concern-1" }] },
        workingContextDelta: [
          { op: "upsert", item: { id: oldId, conversationId: "thread-1", type: "referent", text: entity === "HY3" ? "HY4" : "Alpha", concernId: "concern-1", sourceTurnIds: [mention.rowId], status: "active", supersedesId: null } },
          { op: "supersede", id: oldId, replacement: { id: `wc-${entity}-new`, conversationId: "thread-1", type: "owner_teaching", text: `${newEntity} is an LLM`, concernId: "concern-1", sourceTurnIds: [correction.rowId], status: "active", supersedesId: oldId } },
        ],
      }))).toMatchObject({ published: true });
      expect(listWorkingContext(db, "thread-1")).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: `${newEntity} is an LLM`, status: "active" }),
      ]));
      expect(db.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log WHERE conversation_id = 'thread-1'").get()).toMatchObject({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("makes delivered Ashley speech available as evidence for the next Thought", () => {
    const db = openTestSidecar();
    try {
      const speech = appendAshleyEvidence(db, { conversationId: "thread-1", text: "because it is a small model", delivered: true, discordMessageIds: ["ashley-1"], nowMs: 1 });
      const cycle = admitTestCycle(db, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "what-did-you-say", occupantId: "doc", nowMs: 2 });
      const owner = appendOwnerUtterance(db, { conversationId: "thread-1", text: "what did you just say?", discordMessageIds: ["owner-1"], nowMs: 3 });
      const input = buildThoughtInput({ sidecar: db, cycle, triggerText: owner.text ?? "", triggerEvidence: owner, constitution, capabilityReality, learnedSelfSlice: { dispositions: [], interests: [] } });
      expect(input.rawConversation).toEqual(expect.arrayContaining([expect.objectContaining({ rowId: speech.rowId, role: "ashley", delivered: true })]));
      expect(input.rawConversation.find((row) => row.rowId === speech.rowId)?.text).toContain("small model");
    } finally {
      db.close();
    }
  });

  it("keeps an unanswered concern in compact occupancy", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "question", occupantId: "doc", nowMs: 1 });
      const input = buildThoughtInput({ sidecar: db, cycle, constitution, capabilityReality, learnedSelfSlice: { dispositions: [], interests: [] }, occupancy: [{ conversationId: "thread-1", concernId: "unanswered-question", status: "active", priority: 8, updatedCycle: cycle.cycleId, updatedGeneration: 1 }] });
      expect(input.occupancy).toEqual(expect.arrayContaining([expect.objectContaining({ concernId: "unanswered-question", status: "active" })]));
    } finally {
      db.close();
    }
  });

  it("does not invent a missing historical fact after retrieval miss", () => {
    const db = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      const cycle = admitTestCycle(db, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "month-ago", occupantId: "doc", nowMs: 1 });
      derived.reconcile(db);
      const input = buildThoughtInput({ sidecar: db, cycle, triggerText: "what happened last month?", constitution, capabilityReality, learnedSelfSlice: { dispositions: [], interests: [] }, derivedStore: derived });
      expect(input.retrieval.miss).toBe(true);
      expect(input.retrieval.hits).toEqual([]);
    } finally {
      derived.close();
      db.close();
    }
  });

  it("keeps perturbed fixture construction independent of entity names", () => {
    expect(perturbedContinuitySettlement().triggerRef).toBe("qwen-turn-1");
  });
});

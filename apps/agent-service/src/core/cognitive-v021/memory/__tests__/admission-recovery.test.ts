import { describe, expect, it } from "vitest";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { buildLearnedSelfSlice } from "../../identity/learned-self.js";
import { runGovernedAdmissionCatchup } from "../admission.js";
import type { DurableNomination } from "../../types.js";

function publishLearned(db: Parameters<typeof runGovernedAdmissionCatchup>[0], cycleId: string, conversationId: string, nominationId: string, assertionKey: string, statement: string, settlementId: string, supersedesAssertionKey: string | null = null): void {
  const evidence = appendOwnerUtterance(db, {
    conversationId,
    text: "The owner supplied grounding.",
    discordMessageIds: [`${nominationId}-message`],
    nowMs: 1,
  });
  admitTestCycle(db, {
    cycleId,
    conversationId,
    generation: Number(cycleId.endsWith("-2") ? 2 : 1),
    triggerKind: "owner_message",
    triggerRef: evidence.rowId,
    occupantId: "doc",
    nowMs: 1,
  });
  const value: DurableNomination = {
    nominationId,
    cycleId,
    generation: Number(cycleId.endsWith("-2") ? 2 : 1),
    assertionKey,
    statement,
    memoryKind: "learned_self_evidence",
    dimensions: {
      source: "ashley_interpretation",
      status: "interpreted",
      time: "historical",
      reliability: "inferred",
    },
    dataClassification: "ordinary",
    supersedesAssertionKey,
    concernId: null,
    sourceRefs: [evidence.rowId],
  };
  const draft = makeThoughtDraft({
    cycleId,
    generation: value.generation,
    speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: null, acceptableRealizations: [], presentationDirectives: [] },
    operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
    durableNominations: [value],
  });
  const result = publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  });
  expect(result.published).toBe(true);
}

describe("MAT-II admission crash-durable catch-up", () => {
  it("recovers a committed but unadmitted nomination idempotently", () => {
    const db = openTestSidecar();
    try {
      publishLearned(db, "cycle-recovery", "recovery-thread", "nomination-recovery", "learned:recovery", "disposition: keeps commitments", "settlement-recovery");

      // Simulated process loss occurs after publish commit and before the
      // admission call. The durable nomination must remain visible.
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get("nomination-recovery"))
        .toMatchObject({ admitted: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 0 });

      const recovered = runGovernedAdmissionCatchup(db, { nowMs: 2 });
      const repeated = runGovernedAdmissionCatchup(db, { nowMs: 3 });

      expect(recovered.admitted).toBe(1);
      expect(repeated.considered).toBe(0);
      expect(repeated.admitted).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 1 });
      expect(buildLearnedSelfSlice(db).dispositions).toEqual(["keeps commitments"]);
    } finally {
      db.close();
    }
  });

  it("keeps a current owner-origin nomination pending when provenance entitlement is absent", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "provenance-thread",
        text: "Currentness needs evidence.",
        discordMessageIds: ["provenance-message"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-provenance",
        conversationId: "provenance-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: evidence.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      const nomination: DurableNomination = {
        nominationId: "nomination-provenance",
        cycleId: "cycle-provenance",
        generation: 1,
        assertionKey: "learned:current",
        statement: "disposition: current claim",
        memoryKind: "learned_self_evidence",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        },
        dataClassification: "ordinary",
        supersedesAssertionKey: null,
        concernId: null,
        sourceRefs: [],
      };
      const draft = makeThoughtDraft({
        cycleId: nomination.cycleId,
        generation: nomination.generation,
        speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: null, acceptableRealizations: [], presentationDirectives: [] },
        operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
        durableNominations: [nomination],
      });
      publishSemanticTransaction(db, {
        ...draft,
        settlementId: "settlement-provenance",
        speech: { ...draft.speech, finalLicensedText: null },
      });

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(result.skippedProvenance).toBe(1);
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get("nomination-provenance"))
        .toMatchObject({ admitted: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });
});

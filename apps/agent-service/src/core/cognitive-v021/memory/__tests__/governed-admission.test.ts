import { describe, expect, it } from "vitest";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { buildLearnedSelfSlice } from "../../identity/learned-self.js";
import {
  runGovernedAdmissionCatchup,
} from "../admission.js";
import { FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST } from "../admission-allowlist.js";
import { listDurableNominations } from "../nomination.js";
import type { DurableNomination } from "../../types.js";

function nomination(overrides: Partial<DurableNomination> = {}): DurableNomination {
  return {
    nominationId: "nomination-learned",
    cycleId: "cycle-learned",
    generation: 1,
    assertionKey: "learned:disposition",
    statement: "disposition: prefers precise explanations",
    memoryKind: "learned_self_evidence",
    dimensions: {
      source: "ashley_interpretation",
      status: "interpreted",
      time: "historical",
      reliability: "inferred",
    },
    dataClassification: "ordinary",
    supersedesAssertionKey: null,
    concernId: null,
    sourceRefs: [],
    ...overrides,
  };
}

function publishNominations(db: Parameters<typeof runGovernedAdmissionCatchup>[0], values: DurableNomination[], settlementId: string): void {
  const draft = makeThoughtDraft({
    cycleId: values[0].cycleId,
    generation: values[0].generation,
    speech: {
      mode: "none",
      mustSay: [],
      mustNot: [],
      surfaceDraft: null,
      acceptableRealizations: [],
      presentationDirectives: [],
    },
    operations: {
      ...makeThoughtDraft().operations,
      observationsConsumed: [],
    },
    durableNominations: values,
  });
  const result = publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  });
  expect(result.published).toBe(true);
}

function publishNomination(db: Parameters<typeof runGovernedAdmissionCatchup>[0], value: DurableNomination, settlementId: string): void {
  publishNominations(db, [value], settlementId);
}

describe("MAT-II governed automatic admission", () => {
  it("admits only Thought-authored learned_self_evidence through the frozen automatic path", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "learned-thread",
        text: "I value precise explanations.",
        discordMessageIds: ["learned-message"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-learned",
        conversationId: "learned-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: evidence.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      publishNomination(db, nomination({ sourceRefs: [evidence.rowId] }), "settlement-learned");

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST).toEqual(["learned_self_evidence"]);
      expect(result.admitted).toBe(1);
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get("nomination-learned"))
        .toMatchObject({ admitted: 1 });
      expect(db.prepare("SELECT live, statement FROM sidecar_memory_assertions WHERE assertion_key = ?").get("learned:disposition"))
        .toMatchObject({ live: 1, statement: "disposition: prefers precise explanations" });
      expect(buildLearnedSelfSlice(db)).toEqual({
        dispositions: ["prefers precise explanations"],
        interests: [],
        supportRefs: ["nomination-learned"],
      });
    } finally {
      db.close();
    }
  });

  it("leaves non-allowlisted kinds durable and unminted", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "nonallowlisted-thread",
        text: "A source fact.",
        discordMessageIds: ["nonallowlisted-message"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-nonallowlisted",
        conversationId: "nonallowlisted-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: evidence.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      publishNomination(db, nomination({
        nominationId: "nomination-world",
        cycleId: "cycle-nonallowlisted",
        assertionKey: "world:fact",
        memoryKind: "owner_world_claim",
        statement: "The world has a fact.",
        sourceRefs: [evidence.rowId],
      }), "settlement-world");

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(result.considered).toBe(0);
      expect(listDurableNominations(db, { admitted: false, allowedKinds: FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST }))
        .toHaveLength(0);
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get("nomination-world"))
        .toMatchObject({ admitted: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("does not infer learned-self adoption from verified Owner evidence", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "owner-origin-thread",
        text: "I value precise explanations.",
        discordMessageIds: ["owner-origin-message"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-owner-origin",
        conversationId: "owner-origin-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: evidence.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      const ownerOrigin = nomination({
        nominationId: "nomination-owner-origin",
        cycleId: "cycle-owner-origin",
        assertionKey: "learned:owner-origin",
        statement: "I value precise explanations.",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "historical",
          reliability: "owner_supplied",
        },
        sourceRefs: [evidence.rowId],
      });
      publishNomination(db, ownerOrigin, "settlement-owner-origin");

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get(ownerOrigin.nominationId))
        .toMatchObject({ admitted: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 0 });
      expect(buildLearnedSelfSlice(db)).toEqual({ dispositions: [], interests: [] });
    } finally {
      db.close();
    }
  });

  it("requires the nomination to be present in the published Thought settlement", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-unpublished-nomination",
        conversationId: "unpublished-nomination-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "unpublished-nomination",
        occupantId: "doc",
        nowMs: 1,
      });
      const candidate = nomination({
        nominationId: "nomination-not-in-payload",
        cycleId: "cycle-unpublished-nomination",
        assertionKey: "learned:not-in-payload",
      });
      db.prepare(
        `INSERT INTO durable_nominations
           (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
            dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted, source_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(
        candidate.nominationId,
        candidate.cycleId,
        candidate.generation,
        candidate.assertionKey,
        candidate.statement,
        candidate.memoryKind,
        JSON.stringify(candidate.dimensions),
        candidate.dataClassification,
        candidate.supersedesAssertionKey,
        candidate.concernId,
        JSON.stringify(candidate.sourceRefs),
      );
      const draft = makeThoughtDraft({
        cycleId: candidate.cycleId,
        generation: candidate.generation,
        speech: {
          mode: "none",
          mustSay: [],
          mustNot: [],
          surfaceDraft: null,
          acceptableRealizations: [],
          presentationDirectives: [],
        },
        operations: {
          ...makeThoughtDraft().operations,
          observationsConsumed: [],
        },
        durableNominations: [],
      });
      expect(publishSemanticTransaction(db, {
        ...draft,
        settlementId: "settlement-without-nomination",
        speech: { ...draft.speech, finalLicensedText: null },
      }).published).toBe(true);

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(0);
      expect(result.skippedUnpublished).toBe(1);
      expect(db.prepare("SELECT admitted FROM durable_nominations WHERE nomination_id = ?").get(candidate.nominationId))
        .toMatchObject({ admitted: 0 });
    } finally {
      db.close();
    }
  });

  it("allows an Owner-origin nomination only with Thought's Ashley-source interpretation", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "owner-exception-thread",
        text: "I value precise explanations.",
        discordMessageIds: ["owner-exception-message"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-owner-exception",
        conversationId: "owner-exception-thread",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: evidence.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      const ownerOrigin = nomination({
        nominationId: "nomination-owner-exception",
        cycleId: "cycle-owner-exception",
        assertionKey: "learned:owner-exception",
        statement: "I value precise explanations.",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "historical",
          reliability: "owner_supplied",
        },
        sourceRefs: [evidence.rowId],
      });
      const adoption = nomination({
        nominationId: "nomination-ashley-adoption",
        cycleId: "cycle-owner-exception",
        assertionKey: "learned:ashley-adoption",
        statement: ownerOrigin.statement,
        dimensions: {
          source: "ashley_interpretation",
          status: "interpreted",
          time: "historical",
          reliability: "inferred",
        },
      });
      publishNominations(db, [ownerOrigin, adoption], "settlement-owner-exception");

      const result = runGovernedAdmissionCatchup(db, { nowMs: 2 });

      expect(result.admitted).toBe(2);
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get())
        .toMatchObject({ count: 2 });
    } finally {
      db.close();
    }
  });
});

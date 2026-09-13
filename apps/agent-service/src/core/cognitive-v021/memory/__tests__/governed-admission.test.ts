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

function publishNomination(db: Parameters<typeof runGovernedAdmissionCatchup>[0], value: DurableNomination, settlementId: string): void {
  const draft = makeThoughtDraft({
    cycleId: value.cycleId,
    generation: value.generation,
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
    durableNominations: [value],
  });
  const result = publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  });
  expect(result.published).toBe(true);
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
});

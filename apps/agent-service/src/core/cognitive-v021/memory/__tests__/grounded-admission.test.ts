import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { runGovernedAdmissionCatchup } from "../admission.js";
import { getMemoryStrength } from "../strength.js";
import { AUTOMATIC_ADMISSION_GROUNDING } from "../grounding.js";
import { MEMORY_KINDS } from "../kinds.js";
import type { DurableNomination, MemoryKind, SourceSupportRef } from "../../types.js";

const OWNER_TEXT = "honestly I can't stand cilantro, it tastes like soap to me";

type Fixture = { db: DatabaseSync; ownerRowId: string; ashleyRowId: string };

function fixture(): Fixture {
  const db = openTestSidecar();
  const owner = appendOwnerUtterance(db, {
    conversationId: "grounded-thread",
    text: OWNER_TEXT,
    discordMessageIds: ["grounded-owner"],
    nowMs: 1,
  });
  const ashley = appendAshleyEvidence(db, {
    conversationId: "grounded-thread",
    text: "noted, no cilantro in anything I recommend you",
    nowMs: 2,
  });
  admitTestCycle(db, {
    cycleId: "cycle-grounded",
    conversationId: "grounded-thread",
    generation: 1,
    triggerKind: "owner_message",
    triggerRef: owner.rowId,
    occupantId: "doc",
    nowMs: 1,
  });
  return { db, ownerRowId: owner.rowId, ashleyRowId: ashley.rowId };
}

function span(rowId: string, text: string, quote: string, start = text.indexOf(quote)): SourceSupportRef {
  return { kind: "conversation_text_span", evidenceRowId: rowId, start, end: start + quote.length, quote };
}

function nomination(kind: MemoryKind, overrides: Partial<DurableNomination> = {}): DurableNomination {
  const ashleyAuthored = AUTOMATIC_ADMISSION_GROUNDING[kind] === "ashley_authored";
  return {
    nominationId: `nomination-${kind}`,
    cycleId: "cycle-grounded",
    generation: 1,
    assertionKey: `key:${kind}`,
    statement: `statement for ${kind}`,
    memoryKind: kind,
    dimensions: ashleyAuthored
      ? { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" }
      : { source: "owner_utterance", status: "asserted", time: "unknown_freshness", reliability: "owner_supplied" },
    dataClassification: "ordinary",
    supersedesAssertionKey: null,
    concernId: null,
    sourceRefs: [],
    ...overrides,
  };
}

function publish(db: DatabaseSync, values: DurableNomination[], settlementId = "settlement-grounded"): void {
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
    operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
    durableNominations: values,
  });
  expect(publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  }).published).toBe(true);
}

function liveStatements(db: DatabaseSync): string[] {
  return (db.prepare("SELECT statement FROM sidecar_memory_assertions WHERE live = 1 ORDER BY statement").all() as Array<{ statement: string }>)
    .map((row) => row.statement);
}

describe("Growth V1 grounded automatic admission", () => {
  it("covers every MemoryKind with a grounding rule", () => {
    expect(Object.keys(AUTOMATIC_ADMISSION_GROUNDING).sort()).toEqual([...MEMORY_KINDS].sort());
  });

  it("admits an Owner preference that quotes the Owner verbatim, with no directive", () => {
    const { db, ownerRowId } = fixture();
    try {
      publish(db, [nomination("owner_preference", {
        statement: "Alex dislikes cilantro; it tastes like soap to him.",
        supportRefs: [span(ownerRowId, OWNER_TEXT, "I can't stand cilantro")],
      })]);

      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });

      expect(result.admitted).toBe(1);
      expect(liveStatements(db)).toEqual(["Alex dislikes cilantro; it tastes like soap to him."]);
    } finally {
      db.close();
    }
  });

  it("re-anchors a verbatim quote whose character offsets are wrong", () => {
    const { db, ownerRowId } = fixture();
    try {
      publish(db, [nomination("owner_preference", {
        supportRefs: [span(ownerRowId, OWNER_TEXT, "tastes like soap", 0)],
      })]);

      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects an Owner claim whose quote the Owner never wrote", () => {
    const { db, ownerRowId } = fixture();
    try {
      publish(db, [nomination("owner_preference", {
        supportRefs: [{ kind: "conversation_text_span", evidenceRowId: ownerRowId, start: 0, end: 12, quote: "I love coriander" }],
      })]);

      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });

      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
      expect(liveStatements(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects an Owner claim grounded only by a bare row ref or by Ashley's own words", () => {
    const { db, ownerRowId, ashleyRowId } = fixture();
    try {
      publish(db, [
        nomination("owner_goal", { sourceRefs: [ownerRowId] }),
        nomination("owner_self_description", {
          dimensions: { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
          supportRefs: [span(ashleyRowId, "noted, no cilantro in anything I recommend you", "no cilantro")],
        }),
      ]);

      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });

      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(2);
    } finally {
      db.close();
    }
  });

  it("admits Ashley-authored kinds as her own interpretation without Owner evidence", () => {
    const { db } = fixture();
    try {
      publish(db, [
        nomination("ashley_interpretation", { statement: "Alex's food opinions come with sensory detail." }),
        nomination("open_question", { statement: "Is the soap taste genetic for Alex?" }),
      ]);

      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });

      expect(result.admitted).toBe(2);
      expect(db.prepare("SELECT dimensions_json FROM sidecar_memory_assertions WHERE assertion_key = ?").get("key:ashley_interpretation"))
        .toMatchObject({ dimensions_json: expect.stringContaining("ashley_interpretation") });
    } finally {
      db.close();
    }
  });

  it("admits a shared episode that quotes either side of the conversation", () => {
    const { db, ashleyRowId } = fixture();
    try {
      publish(db, [
        nomination("shared_episode", {
          dimensions: { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
          supportRefs: [span(ashleyRowId, "noted, no cilantro in anything I recommend you", "no cilantro")],
        }),
      ]);

      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
    } finally {
      db.close();
    }
  });

  it("stores Thought's salience as the new memory's strength", () => {
    const { db, ownerRowId } = fixture();
    try {
      publish(db, [
        nomination("owner_preference", { salience: 0.9, supportRefs: [span(ownerRowId, OWNER_TEXT, "I can't stand cilantro")] }),
        nomination("open_question"),
      ]);

      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(2);
      expect(getMemoryStrength(db, "key:owner_preference")).toMatchObject({ salience: 0.9, formedAtMs: 3, useCount: 0 });
      expect(getMemoryStrength(db, "key:open_question")?.salience).toBe(0.5);
    } finally {
      db.close();
    }
  });

  it("decides each nomination once: a rejection is final and is not rescanned", () => {
    const { db, ownerRowId } = fixture();
    try {
      publish(db, [nomination("owner_goal", { sourceRefs: [ownerRowId] })]);

      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).considered).toBe(1);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 4 }).considered).toBe(0);
    } finally {
      db.close();
    }
  });
});

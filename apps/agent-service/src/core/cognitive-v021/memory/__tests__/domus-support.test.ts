import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { runGovernedAdmissionCatchup } from "../admission.js";
import { hashMemoryAssertion } from "../assertions.js";
import { AUTOMATIC_ADMISSION_GROUNDING } from "../grounding.js";
import { admitObservation } from "../../../domus/store.js";
import type { DurableNomination, MemoryKind, SourceSupportRef } from "../../types.js";

const OWNER_TEXT = "honestly I can't stand cilantro, it tastes like soap to me";

type Fixture = { db: DatabaseSync; ownerRowId: string };

function fixture(): Fixture {
  const db = openTestSidecar();
  const owner = appendOwnerUtterance(db, {
    conversationId: "grounded-thread",
    text: OWNER_TEXT,
    discordMessageIds: ["grounded-owner"],
    nowMs: 1,
  });
  appendAshleyEvidence(db, {
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
  return { db, ownerRowId: owner.rowId };
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

function storeObservation(db: DatabaseSync, observationId: string, world: string, patch: { admissionState?: string; undoneAtMs?: number } = {}): void {
  expect(admitObservation(db, {
    observationId,
    digest: `digest-${observationId}`,
    world,
    branch: "main",
    session: "session-1",
    attachment: "attach",
    body: "body",
    snapshot: "snap",
    seq: 1,
    sourceTimeMs: 10,
    expiresAtMs: 20,
    receiptTimeMs: 11,
    lineageClass: "CONTINUES_LAST_SAVE",
    payloadJson: "{}",
  }).status).toBe("admitted");
  if (patch.admissionState) {
    db.prepare("UPDATE domus_observations SET admission_state = ? WHERE observation_id = ?")
      .run(patch.admissionState, observationId);
  }
  if (patch.undoneAtMs != null) {
    db.prepare("UPDATE domus_observations SET undone_at_ms = ? WHERE observation_id = ?")
      .run(patch.undoneAtMs, observationId);
  }
}

function domusRef(observationId: string): SourceSupportRef {
  return { kind: "domus_observation", observationId };
}

describe("8b-1 domus observation support", () => {
  it("admits an ashley interpretation on one stored domus observation", () => {
    const { db } = fixture();
    try {
      storeObservation(db, "obs-a", "willow-creek");
      const ref = domusRef("obs-a");
      publish(db, [nomination("ashley_interpretation", { supportRefs: [ref] })]);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
      const assertion = db.prepare(
        "SELECT channel, lineage_class FROM sidecar_memory_assertions WHERE assertion_key = ?",
      ).get("key:ashley_interpretation") as { channel: string; lineage_class: string };
      expect(assertion).toEqual({ channel: "domus:willow-creek", lineage_class: "current" });
      const support = db.prepare(
        "SELECT channel, lineage_class, support_ref_json FROM sidecar_memory_supports WHERE support_id = ?",
      ).get("native:nomination-ashley_interpretation:typed:0") as { channel: string; lineage_class: string; support_ref_json: string };
      expect(support.channel).toBe("domus:willow-creek");
      expect(support.lineage_class).toBe("current");
      expect(JSON.parse(support.support_ref_json)).toEqual(ref);
    } finally {
      db.close();
    }
  });

  it("skips a missing observation id", () => {
    const { db } = fixture();
    try {
      publish(db, [nomination("ashley_interpretation", { supportRefs: [domusRef("missing")] })]);
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
    } finally {
      db.close();
    }
  });

  it("skips a dropped observation and an undone observation", () => {
    const { db } = fixture();
    try {
      storeObservation(db, "obs-dropped", "willow-creek", { admissionState: "dropped" });
      storeObservation(db, "obs-undone", "willow-creek", { undoneAtMs: 50 });
      publish(db, [
        nomination("ashley_interpretation", { nominationId: "n-dropped", assertionKey: "key:dropped", supportRefs: [domusRef("obs-dropped")] }),
        nomination("open_question", { nominationId: "n-undone", assertionKey: "key:undone", supportRefs: [domusRef("obs-undone")] }),
      ]);
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(2);
    } finally {
      db.close();
    }
  });

  it("skips two worlds as a mixed channel", () => {
    const { db } = fixture();
    try {
      storeObservation(db, "obs-w1", "willow-creek");
      storeObservation(db, "obs-w2", "oasis-springs");
      publish(db, [nomination("ashley_interpretation", {
        supportRefs: [domusRef("obs-w1"), domusRef("obs-w2")],
      })]);
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
    } finally {
      db.close();
    }
  });

  it("skips an owner span mixed with a domus observation", () => {
    const { db, ownerRowId } = fixture();
    try {
      storeObservation(db, "obs-mix", "willow-creek");
      const quote = "I can't stand cilantro";
      const start = OWNER_TEXT.indexOf(quote);
      publish(db, [nomination("ashley_interpretation", {
        supportRefs: [
          { kind: "conversation_text_span", evidenceRowId: ownerRowId, start, end: start + quote.length, quote },
          domusRef("obs-mix"),
        ],
      })]);
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
    } finally {
      db.close();
    }
  });

  it("does not ground an owner world claim on a domus observation", () => {
    const { db } = fixture();
    try {
      storeObservation(db, "obs-claim", "willow-creek");
      publish(db, [nomination("owner_world_claim", {
        dimensions: { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
        supportRefs: [domusRef("obs-claim")],
      })]);
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(0);
      expect(result.skippedProvenance).toBe(1);
    } finally {
      db.close();
    }
  });

  it("stamps discord and keeps the pre-channel content hash", () => {
    const { db, ownerRowId } = fixture();
    try {
      const quote = "I can't stand cilantro";
      const start = OWNER_TEXT.indexOf(quote);
      const drafted = nomination("owner_preference", {
        statement: "Alex dislikes cilantro.",
        supportRefs: [{ kind: "conversation_text_span", evidenceRowId: ownerRowId, start, end: start + quote.length, quote }],
      });
      const expectedHash = hashMemoryAssertion({
        assertionKey: drafted.assertionKey,
        statement: drafted.statement,
        memoryKind: drafted.memoryKind,
        dimensions: drafted.dimensions,
        dataClassification: drafted.dataClassification,
        lineageParentKey: drafted.supersedesAssertionKey,
        admittedGeneration: drafted.generation,
        live: true,
      });
      publish(db, [drafted]);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
      const row = db.prepare(
        "SELECT channel, lineage_class, content_hash FROM sidecar_memory_assertions WHERE assertion_key = ?",
      ).get(drafted.assertionKey) as { channel: string; lineage_class: string; content_hash: string };
      expect(row.channel).toBe("discord");
      expect(row.lineage_class).toBe("current");
      expect(row.content_hash).toBe(expectedHash);
      expect(hashMemoryAssertion({
        assertionKey: drafted.assertionKey,
        statement: drafted.statement,
        memoryKind: drafted.memoryKind,
        dimensions: drafted.dimensions,
        dataClassification: drafted.dataClassification,
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      })).toBe(expectedHash);
    } finally {
      db.close();
    }
  });

  it("admits a duplicated domus observation ref once without crashing", () => {
    const { db } = fixture();
    try {
      storeObservation(db, "obs-dup", "willow-creek");
      publish(db, [nomination("ashley_interpretation", {
        supportRefs: [domusRef("obs-dup"), domusRef("obs-dup")],
      })]);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
      const typed = db.prepare(
        "SELECT COUNT(*) AS n FROM sidecar_memory_supports WHERE assertion_key = ? AND support_ref_json IS NOT NULL",
      ).get("key:ashley_interpretation") as { n: number };
      // Same as observation_ref: no dedup. Both copies are stored under typed indexes.
      expect(typed.n).toBe(2);
    } finally {
      db.close();
    }
  });
});

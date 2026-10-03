import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { runGovernedAdmissionCatchup } from "../admission.js";
import { getMemoryAssertion, hashMemoryAssertion, listMemoryAssertions, REDACTED_MEMORY_STATEMENT } from "../assertions.js";
import { applyV021Forget } from "../forget.js";
import { recordEpisode } from "../episodes.js";
import { AUTOMATIC_ADMISSION_GROUNDING } from "../grounding.js";
import { admitObservation } from "../../../domus/store.js";
import { recordJournalEntry } from "../../initiative/journal.js";
import { markDomusSpanUndone } from "../undo.js";
import type { DurableNomination, MemoryKind, SourceSupportRef } from "../../types.js";

const OWNER_TEXT = "honestly I can't stand cilantro, it tastes like soap to me";
const NOW = 9_000;

function fixture(): DatabaseSync {
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
  return db;
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

function publish(db: DatabaseSync, values: DurableNomination[], settlementId = "settlement-undo"): void {
  const draft = makeThoughtDraft({
    cycleId: values[0].cycleId,
    generation: values[0].generation,
    speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: null, acceptableRealizations: [], presentationDirectives: [] },
    operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
    durableNominations: values,
  });
  expect(publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  }).published).toBe(true);
}

function store(
  db: DatabaseSync,
  observationId: string,
  world: string,
  session: string,
  sourceTimeMs: number,
  receiptTimeMs: number,
): void {
  expect(admitObservation(db, {
    observationId,
    digest: `digest-${observationId}`,
    world,
    branch: "main",
    session,
    attachment: "attach",
    body: "body",
    snapshot: "snap",
    seq: 1,
    sourceTimeMs,
    expiresAtMs: sourceTimeMs + 10,
    receiptTimeMs,
    lineageClass: "CONTINUES_LAST_SAVE",
    payloadJson: "{}",
  }).status).toBe("admitted");
}

function ref(observationId: string): SourceSupportRef {
  return { kind: "domus_observation", observationId };
}

function lineage(db: DatabaseSync, key: string): string {
  return (db.prepare("SELECT lineage_class FROM sidecar_memory_assertions WHERE assertion_key = ?").get(key) as { lineage_class: string }).lineage_class;
}

describe("markDomusSpanUndone", () => {
  it("marks only the abandoned span and is idempotent", () => {
    const db = fixture();
    try {
      store(db, "in-span", "willow", "s1", 300, 500);
      store(db, "before", "willow", "s1", 100, 150);
      store(db, "other-session", "willow", "s2", 300, 500);
      store(db, "other-world", "oasis", "s1", 300, 500);
      publish(db, [
        nomination("ashley_interpretation", { assertionKey: "key:in", statement: "in span reading", supportRefs: [ref("in-span")] }),
        nomination("open_question", { nominationId: "n-before", assertionKey: "key:before", statement: "before the cut", supportRefs: [ref("before")] }),
        nomination("open_question", { nominationId: "n-forget", assertionKey: "key:forget", statement: "zzforgettoken in span", supportRefs: [ref("in-span")] }),
        nomination("owner_preference", {
          nominationId: "n-discord",
          assertionKey: "key:discord",
          statement: "discord stays",
          supportRefs: [{ kind: "conversation_text_span", evidenceRowId: (db.prepare("SELECT row_id FROM conversation_evidence_log WHERE text LIKE '%cilantro%'").get() as { row_id: string }).row_id, start: OWNER_TEXT.indexOf("cilantro"), end: OWNER_TEXT.indexOf("cilantro") + "cilantro".length, quote: "cilantro" }],
        }),
      ]);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(4);
      applyV021Forget(db, { topic: "zzforgettoken", nowMs: 4 });
      recordEpisode(db, {
        conversationId: "grounded-thread",
        cycleId: "cycle-ep-in",
        rows: [{ rowId: "row-ep", createdAtMs: 500, dataClassification: "ordinary" }],
        reflection: { summary: "span episode", salience: 0.5 },
        nowMs: 500,
        channel: "domus:willow",
      });
      recordEpisode(db, {
        conversationId: "grounded-thread",
        cycleId: "cycle-ep-early",
        rows: [{ rowId: "row-ep-early", createdAtMs: 100, dataClassification: "ordinary" }],
        reflection: { summary: "early episode", salience: 0.5 },
        nowMs: 149,
        channel: "domus:willow",
      });
      recordEpisode(db, {
        conversationId: "grounded-thread",
        cycleId: "cycle-ep-other",
        rows: [{ rowId: "row-ep-other", createdAtMs: 500, dataClassification: "ordinary" }],
        reflection: { summary: "other world", salience: 0.5 },
        nowMs: 500,
        channel: "domus:oasis",
      });
      recordJournalEntry(db, { conversationId: "grounded-thread", cycleId: "cycle-j-in", passKind: "private", spoke: false, nowMs: 500, channel: "domus:willow" });
      recordJournalEntry(db, { conversationId: "grounded-thread", cycleId: "cycle-j-early", passKind: "private", spoke: false, nowMs: 149, channel: "domus:willow" });
      const before = getMemoryAssertion(db, "key:in");
      expect(before).not.toBeNull();
      const storedHash = (db.prepare("SELECT content_hash, live, statement FROM sidecar_memory_assertions WHERE assertion_key = ?").get("key:in") as { content_hash: string; live: number; statement: string });
      const preHash = hashMemoryAssertion(before!);
      expect(storedHash.content_hash).toBe(preHash);

      const span = { world: "willow", branch: "main", session: "s1", afterSourceTimeMs: 200 };
      const first = markDomusSpanUndone(db, span, NOW);
      expect(first).toEqual({ observations: 1, supports: 2, assertions: 1, episodes: 1, journal: 1 });
      expect(db.prepare("SELECT undone_at_ms FROM domus_observations WHERE observation_id = ?").get("in-span")).toEqual({ undone_at_ms: NOW });
      expect(db.prepare("SELECT undone_at_ms FROM domus_observations WHERE observation_id = ?").get("before")).toEqual({ undone_at_ms: null });
      expect(lineage(db, "key:in")).toBe("undone");
      expect(lineage(db, "key:before")).toBe("current");
      expect(lineage(db, "key:discord")).toBe("current");
      expect(lineage(db, "key:forget")).toBe("current");
      const flipped = getMemoryAssertion(db, "key:in")!;
      const flippedRow = db.prepare("SELECT content_hash, live, statement FROM sidecar_memory_assertions WHERE assertion_key = ?").get("key:in") as { content_hash: string; live: number; statement: string };
      expect(flipped.live).toBe(true);
      expect(flipped.statement).toBe("in span reading");
      expect(flippedRow.live).toBe(1);
      expect(flippedRow.statement).toBe(storedHash.statement);
      expect(flippedRow.content_hash).toBe(preHash);
      expect(hashMemoryAssertion(flipped)).toBe(preHash);
      const forgotten = getMemoryAssertion(db, "key:forget")!;
      expect(forgotten.statement).toBe(REDACTED_MEMORY_STATEMENT);
      expect(db.prepare("SELECT lineage_class, support_ref_json FROM sidecar_memory_supports WHERE assertion_key = ?").all("key:forget")).toEqual(
        expect.arrayContaining([expect.objectContaining({ lineage_class: "current", support_ref_json: null })]),
      );
      expect((db.prepare("SELECT lineage_class FROM episodes_v2 WHERE cycle_id = ?").get("cycle-ep-in") as { lineage_class: string }).lineage_class).toBe("undone");
      expect((db.prepare("SELECT lineage_class FROM episodes_v2 WHERE cycle_id = ?").get("cycle-ep-early") as { lineage_class: string }).lineage_class).toBe("current");
      expect((db.prepare("SELECT lineage_class FROM episodes_v2 WHERE cycle_id = ?").get("cycle-ep-other") as { lineage_class: string }).lineage_class).toBe("current");
      expect((db.prepare("SELECT lineage_class FROM activity_journal WHERE cycle_id = ?").get("cycle-j-in") as { lineage_class: string }).lineage_class).toBe("undone");
      expect((db.prepare("SELECT lineage_class FROM activity_journal WHERE cycle_id = ?").get("cycle-j-early") as { lineage_class: string }).lineage_class).toBe("current");
      const visible = listMemoryAssertions(db, { modelContext: true }).map((row) => row.assertionKey);
      expect(visible).not.toContain("key:in");
      expect(visible).toContain("key:before");
      expect(markDomusSpanUndone(db, span, NOW)).toEqual({ observations: 0, supports: 0, assertions: 0, episodes: 0, journal: 0 });
    } finally {
      db.close();
    }
  });

  it("lets a later forget redact an undone assertion and skips an already forgotten one", () => {
    const db = fixture();
    try {
      store(db, "in-span", "willow", "s1", 300, 500);
      publish(db, [
        nomination("ashley_interpretation", { assertionKey: "key:later", statement: "laterforgettoken reading", supportRefs: [ref("in-span")] }),
      ]);
      expect(runGovernedAdmissionCatchup(db, { nowMs: 3 }).admitted).toBe(1);
      markDomusSpanUndone(db, { world: "willow", branch: "main", session: "s1", afterSourceTimeMs: 200 }, NOW);
      applyV021Forget(db, { topic: "laterforgettoken", nowMs: 4 });
      expect(getMemoryAssertion(db, "key:later")!.statement).toBe(REDACTED_MEMORY_STATEMENT);
      expect(lineage(db, "key:later")).toBe("undone");

      store(db, "in-span-2", "willow", "s1", 400, 600);
      admitTestCycle(db, {
        cycleId: "cycle-gone",
        conversationId: "grounded-thread",
        generation: 2,
        triggerKind: "owner_message",
        triggerRef: "row-gone",
        occupantId: "doc",
        nowMs: 5,
      });
      publish(db, [
        nomination("open_question", { nominationId: "n-gone", cycleId: "cycle-gone", generation: 2, assertionKey: "key:gone", statement: "alreadygone token", supportRefs: [ref("in-span-2")] }),
      ], "settlement-gone");
      expect(runGovernedAdmissionCatchup(db, { nowMs: 5 }).admitted).toBe(1);
      applyV021Forget(db, { topic: "alreadygone", nowMs: 6 });
      const beforeLive = getMemoryAssertion(db, "key:gone");
      const second = markDomusSpanUndone(db, { world: "willow", branch: "main", session: "s1", afterSourceTimeMs: 350 }, NOW + 1);
      expect(second.assertions).toBe(0);
      expect(getMemoryAssertion(db, "key:gone")).toEqual(beforeLive);
      expect(lineage(db, "key:gone")).toBe("current");
    } finally {
      db.close();
    }
  });
});

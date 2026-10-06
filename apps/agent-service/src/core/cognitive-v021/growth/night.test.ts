import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { getMemoryAssertion, upsertMemoryAssertion } from "../memory/assertions.js";
import { getMemoryStrength, recordMemoryFormation } from "../memory/strength.js";
import { recordInterestTouches } from "../memory/interests.js";
import { applyV021Forget, applyV021ForgetTargets, planV021Forget } from "../memory/forget.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
import { makeSemanticSettlement } from "../test-support.js";
import type { NightPass } from "../initiative/inner-pass.js";
import { appendMemorySupport } from "../memory/supports.js";
import { buildNightAgenda, latestDreamReceipt, latestNarrative, listDiary, recordNight, wordOverlap } from "./night.js";
import { resolveRevisionEvidence } from "./revisions.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 10, 1, 0); // 04:00 at UTC+3
const ZONE = "Etc/GMT-3";
const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };

function memory(db: DatabaseSync, key: string, statement: string, kind: "learned_self_evidence" | "open_question" | "ashley_interpretation", atMs: number): void {
  upsertMemoryAssertion(db, { assertionKey: key, statement, memoryKind: kind, dimensions, dataClassification: "ordinary", lineageParentKey: null, admittedGeneration: 1, live: true });
  recordMemoryFormation(db, { assertionKey: key, salience: 0.5, nowMs: atMs });
}

const pass = (weekly = false): NightPass => ({ kind: "night", slot: 3, sinceMs: NOW - DAY, weekly, weekSinceMs: NOW - 7 * DAY });

describe("Growth V1 G5 night consolidation", () => {
  it("gathers the day, overlapping memories, self-evidence, stale questions, and the taste line beside lived branches", () => {
    const db = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      memory(db, "m:a", "Alex prefers short careful answers in the morning.", "ashley_interpretation", NOW - 2 * HOUR);
      memory(db, "m:b", "Alex prefers short careful answers.", "ashley_interpretation", NOW - 10 * DAY);
      memory(db, "m:self", "I enjoyed the Basic Channel deep dive.", "learned_self_evidence", NOW - 3 * HOUR);
      memory(db, "m:q-old", "Why does dub techno feel like weather?", "open_question", NOW - 20 * DAY);
      memory(db, "m:q-new", "What is Alex's interview about?", "open_question", NOW - HOUR);
      recordInterestTouches(db, [{ root: "Cognitive biases", branch: "base-rate neglect", note: "kept coming back" }], NOW - 2 * DAY);

      const agenda = buildNightAgenda(db, { pass: pass(), identityStore: { nuclear, ownerId: "doc" }, nowMs: NOW });
      expect(agenda.memories[0]?.key).toMatch(/^m:(a|self|q-new)$/);
      expect(agenda.similar).toEqual([{ keys: ["m:a", "m:b"], overlap: expect.any(Number) }]);
      expect(agenda.selfEvidence.map((item) => item.key)).toEqual(["m:self"]);
      expect(agenda.staleQuestions.map((item) => item.key)).toEqual(["m:q-old"]);
      expect(agenda.taste.entries.map((entry) => entry.text).join(" ")).toContain("dub techno");
      expect(agenda.taste.branches.map((branch) => branch.branchId)).toContain("cognitive-biases/base-rate-neglect");
      expect(agenda.week).toBeUndefined();
      expect(buildNightAgenda(db, { pass: pass(true), identityStore: null, nowMs: NOW }).week).toMatchObject({ sinceMs: NOW - 7 * DAY, changes: [] });
    } finally {
      db.close();
      nuclear.close();
    }
  });

  it("shows each live memory's support count and lane", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:house", "The kitchen in slot one faces the garden.", "ashley_interpretation", NOW - HOUR);
      db.prepare("UPDATE sidecar_memory_assertions SET channel = ? WHERE assertion_key = ?").run("domus:slot1", "m:house");
      const support = {
        assertionKey: "m:house",
        source: "tool" as const,
        provenance: "native" as const,
        sourceArchitectureEpoch: "v0.2.1" as const,
        sourceRef: null,
        settlementId: null,
        evidenceLineageId: null,
        observationId: null,
        receiptId: null,
        dimensions,
        dataClassification: "ordinary" as const,
        channel: "domus:slot1" as const,
      };
      appendMemorySupport(db, { ...support, supportId: "support:house:1", createdAtMs: NOW - HOUR });
      appendMemorySupport(db, { ...support, supportId: "support:house:2", createdAtMs: NOW - HOUR + 1 });
      const agenda = buildNightAgenda(db, { pass: pass(), identityStore: null, nowMs: NOW });
      expect(agenda.memories.find((item) => item.key === "m:house")).toMatchObject({ supports: 2, lane: "domus:slot1" });
    } finally {
      db.close();
    }
  });

  it("writes a receipt for a night with a claim and an empty receipt without one", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:keep", "Alex's sister is called Lena.", "ashley_interpretation", NOW - DAY);
      memory(db, "m:q", "Why does the garden face west?", "open_question", NOW - 20 * DAY);
      const claimed = recordNight(db, {
        cycleId: "night-receipt", pass: pass(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: {
          diary: "The garden stayed with me.",
          salience: [{ key: "m:keep", salience: 0.8 }],
          closeQuestions: ["m:q"],
        },
      });
      const stored = db.prepare("SELECT receipt_json FROM dream_receipts WHERE cycle_id = ?").get("night-receipt") as { receipt_json: string };
      expect(JSON.parse(stored.receipt_json)).toEqual({
        v: 1,
        diaryId: claimed.diaryId,
        rescored: ["m:keep"],
        closed: ["m:q"],
        narrativeId: null,
        gapsStored: 0,
        chosenId: null,
      });
      recordNight(db, { cycleId: "night-empty", pass: pass(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW + HOUR });
      const empty = db.prepare("SELECT receipt_json FROM dream_receipts WHERE cycle_id = ?").get("night-empty") as { receipt_json: string };
      expect(JSON.parse(empty.receipt_json)).toEqual({
        v: 1, diaryId: null, rescored: [], closed: [], narrativeId: null, gapsStored: 0, chosenId: null,
      });
      expect(db.prepare("SELECT COUNT(*) AS n FROM dream_receipts").get()).toMatchObject({ n: 2 });
    } finally {
      db.close();
    }
  });

  it("reads admitted merges into the latest receipt and leaves out the rest", () => {
    const db = openTestSidecar();
    try {
      recordNight(db, { cycleId: "night-merge", pass: pass(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW });
      const insert = db.prepare(
        `INSERT INTO durable_nominations
           (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
            dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted)
         VALUES (?, 'night-merge', 1, ?, ?, 'ashley_interpretation', '{}', ?, ?, NULL, ?)`,
      );
      insert.run("nom:kept", "m:new", "Lena is Alex's sister, and she gardens.", "ordinary", "m:old", 1);
      insert.run("nom:waiting", "m:later", "A merge still waiting.", "ordinary", "m:other", 0);
      insert.run("nom:secret", "m:hidden", "A secret merge.", "secret", "m:secret-old", 1);
      const receipt = latestDreamReceipt(db);
      expect(receipt?.merged).toEqual([{ from: "m:old", to: "m:new", statement: "Lena is Alex's sister, and she gardens." }]);
      expect(receipt?.diary).toBe(false);
      expect(receipt?.at).toBe(new Date(NOW).toISOString());
    } finally {
      db.close();
    }
  });

  it("measures word overlap mechanically", () => {
    expect(wordOverlap("Alex likes tea", "Alex likes tea")).toBe(1);
    expect(wordOverlap("Alex likes tea", "Ashley reads essays")).toBe(0);
  });

  it("records the diary, re-scored salience, closed questions, and a narrative only on a weekly night", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:keep", "Alex's sister is called Lena.", "ashley_interpretation", NOW - DAY);
      memory(db, "m:q", "Why does dub techno feel like weather?", "open_question", NOW - 20 * DAY);
      memory(db, "m:self", "I like being asked hard questions.", "learned_self_evidence", NOW - DAY);
      const daily = recordNight(db, {
        cycleId: "night-1", pass: pass(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: {
          diary: "A slow day. I kept thinking about Alex's interview.",
          salience: [{ key: "m:keep", salience: 0.9 }, { key: "m:missing", salience: 0.1 }],
          closeQuestions: ["m:q", "m:self"],
          narrative: "Not a weekly night, so this is not kept.",
        },
      });
      expect(daily).toMatchObject({ rescored: ["m:keep"], closed: ["m:q"], narrativeId: null });
      expect(getMemoryStrength(db, "m:keep")?.salience).toBe(0.9);
      // Closing leaves recall but keeps her words; only open questions close.
      expect(getMemoryAssertion(db, "m:q")).toMatchObject({ live: false, statement: "Why does dub techno feel like weather?" });
      expect(getMemoryAssertion(db, "m:self")).toMatchObject({ live: true });
      expect(listDiary(db)).toEqual([expect.objectContaining({ day: "2026-10-09", text: "A slow day. I kept thinking about Alex's interview." })]);
      expect(latestNarrative(db)).toBeNull();

      recordNight(db, {
        cycleId: "night-7", pass: pass(true), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW + 6 * DAY,
        claim: { narrative: "I am becoming someone who reads before she argues." },
      });
      expect(latestNarrative(db)?.text).toBe("I am becoming someone who reads before she argues.");
    } finally {
      db.close();
    }
  });

  it("lets a lived interest branch ground a taste revision, but not a seed she never lived", () => {
    const db = openTestSidecar();
    try {
      expect(resolveRevisionEvidence(db, "interest:electronic-music/dub-techno")).toBeNull();
      recordInterestTouches(db, [{ root: "Electronic music", branch: "dub techno" }], NOW);
      expect(resolveRevisionEvidence(db, "interest:electronic-music/dub-techno")).toMatchObject({ atMs: NOW });
      recordInterestTouches(db, [{ root: "Cognitive biases", branch: "base-rate neglect" }], NOW - DAY);
      expect(resolveRevisionEvidence(db, "interest:cognitive-biases/base-rate-neglect")).toMatchObject({ atMs: NOW - DAY });
      applyV021Forget(db, { topic: "base-rate", nowMs: NOW });
      expect(resolveRevisionEvidence(db, "interest:cognitive-biases/base-rate-neglect")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("joins the forget cascade: diary entries and narratives lose their words", () => {
    const db = openTestSidecar();
    try {
      recordNight(db, { cycleId: "n1", pass: pass(true), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW, claim: { diary: "Kyoto plans all day.", narrative: "Kyoto made me braver." } });
      const plan = planV021Forget(db, { topic: "kyoto" });
      expect(plan.categoryCounts).toMatchObject({ v021_diary_entry: 1, v021_self_narrative: 1 });
      applyV021ForgetTargets(db, plan.targets, { nowMs: NOW + HOUR });
      expect(listDiary(db)).toEqual([]);
      expect(latestNarrative(db)).toBeNull();
      recordNight(db, { cycleId: "n2", pass: pass(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW + DAY, claim: { diary: "Sushi night." } });
      expect(applyV021Forget(db, { topic: "sushi", nowMs: NOW + DAY }).targets.map((target) => target.entityType)).toContain("v021_diary_entry");
    } finally {
      db.close();
    }
  });

  it("parses the night field and rejects malformed ones", () => {
    const parse = (night: unknown) => parseThoughtSemanticOutput(makeSemanticSettlement({ speech: { mode: "none" }, commitments: {}, night }), new Set()).ok;
    expect(parse({ diary: "A slow day." })).toBe(true);
    expect(parse({ salience: [{ key: "m:a", salience: 0.4 }], closeQuestions: ["m:q"], narrative: "Becoming." })).toBe(true);
    expect(parse({})).toBe(false);
    expect(parse({ diary: "x".repeat(1501) })).toBe(false);
    expect(parse({ salience: [{ key: "m:a", salience: 2 }] })).toBe(false);
    expect(parse({ closeQuestions: [] })).toBe(false);
    expect(parse({ dream: "no" })).toBe(false);
  });
});

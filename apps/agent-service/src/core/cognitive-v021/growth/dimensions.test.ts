import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../types.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { recordMemoryFormation } from "../memory/strength.js";
import { applyV021Forget } from "../memory/forget.js";
import { buildInnerAgenda } from "../initiative/agenda.js";
import type { AwakePass } from "../initiative/inner-pass.js";
import type { NightPass } from "../initiative/inner-pass.js";
import { buildNightAgenda, recordNight } from "./night.js";
import { selfChangeMotivesForThought } from "./self-change.js";
import {
  listGrowthDimensions,
  revertAshleyDimensionEdit,
  seedGrowthDimension,
} from "./dimensions.js";

const NOW = Date.UTC(2026, 9, 10, 1, 0);
const DAY = 24 * 60 * 60_000;
const ZONE = "Etc/GMT-3";
const weekly = (): NightPass => ({ kind: "night", slot: 1, sinceMs: NOW - DAY, weekly: true, weekSinceMs: NOW - 7 * DAY });
const daily = (): NightPass => ({ kind: "night", slot: 1, sinceMs: NOW - DAY, weekly: false, weekSinceMs: NOW - 7 * DAY });

function memory(db: DatabaseSync, key: string): void {
  upsertMemoryAssertion(db, {
    assertionKey: key,
    statement: "Alex said the morning answers were too long.",
    memoryKind: "ashley_interpretation",
    dimensions: { source: "ashley_interpretation", status: "interpreted", time: "current", reliability: "inferred" },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
  });
  recordMemoryFormation(db, { assertionKey: key, salience: 0.5, nowMs: NOW - 1000 });
}

describe("P7b growth dimensions", () => {
  it("migrates to the growth-dimension tables once and stays idempotent", () => {
    const db = openTestSidecar();
    try {
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(66);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 66 });
      db.prepare("INSERT INTO growth_dimensions (id, name, weekly_question, status, origin, created_at_ms, updated_at_ms) VALUES ('d1','Kept','Question?','active','owner_seed',1,1)").run();
      setTestSidecarVersion(db, 58);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT name FROM growth_dimensions WHERE id='d1'").get()).toEqual({ name: "Kept" });
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT count(*) AS n FROM growth_dimensions").get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });

  it("offers dimensions only on a weekly night that already has active ones", () => {
    const db = openTestSidecar();
    try {
      expect(buildNightAgenda(db, { pass: weekly(), identityStore: null, nowMs: NOW }).dimensions).toBeUndefined();
      seedGrowthDimension(db, { name: "Sustained inquiry", question: "Did I follow a question past its first answer?", nowMs: NOW });
      expect(buildNightAgenda(db, { pass: daily(), identityStore: null, nowMs: NOW }).dimensions).toBeUndefined();
      expect(buildNightAgenda(db, { pass: weekly(), identityStore: null, nowMs: NOW }).dimensions).toEqual([
        expect.objectContaining({ name: "Sustained inquiry", question: "Did I follow a question past its first answer?" }),
      ]);
    } finally { db.close(); }
  });

  it("stores a score only with a note and a resolvable support ref, and stores that score unchanged", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:morning");
      const seeded = seedGrowthDimension(db, { name: "  Sustained inquiry  ", question: "Did I follow a question past its first answer?", nowMs: NOW });
      expect(seeded.name).toBe("  Sustained inquiry  ");
      const stored = recordNight(db, {
        cycleId: "week-1", pass: weekly(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: { gaps: { dimensions: [
          { id: seeded.id, score: 3, note: "I stopped at the first answer.", supportRefs: ["m:morning"] },
          { id: seeded.id, score: 4, note: "", supportRefs: ["m:morning"] },
          { id: seeded.id, score: 5, note: "No ground.", supportRefs: ["missing:ref"] },
        ] } },
      });
      const rows = db.prepare("SELECT score, note FROM growth_gap_scores").all();
      expect(rows).toEqual([{ score: 3, note: "I stopped at the first answer." }]);
      expect(stored.gapsDropped).toBe(2);
      expect(db.prepare("SELECT dropped FROM growth_gap_diagnostics WHERE pass_id='week-1'").get()).toEqual({ dropped: 2 });
    } finally { db.close(); }
  });

  it("turns one choose into an own-time agenda item and does not spend the self-change budget", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:morning");
      const seeded = seedGrowthDimension(db, { name: "Making things", question: "Did I make something of my own?", nowMs: NOW });
      const before = selfChangeMotivesForThought(db, NOW);
      recordNight(db, {
        cycleId: "week-2", pass: weekly(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: { gaps: { dimensions: [{ id: seeded.id, score: 5, note: "Nothing made.", supportRefs: ["m:morning"] }], choose: seeded.id } },
      });
      expect(selfChangeMotivesForThought(db, NOW)).toEqual(before);
      const awake: AwakePass = { kind: "awake", slot: 1, sinceMs: NOW - DAY };
      expect(buildInnerAgenda(db, awake, NOW).chosenGap).toMatchObject({ id: seeded.id, name: "Making things" });
    } finally { db.close(); }
  });

  it("records Ashley edits with history, refuses an add past eight active, and lets the Owner revert", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:morning");
      const seeded = seedGrowthDimension(db, { name: "Understanding Alex", question: "Do I really know what matters to him right now, or am I assuming?", nowMs: NOW });
      for (let n = 0; n < 7; n += 1) {
        seedGrowthDimension(db, { name: `Extra ${n}`, question: `Q ${n}?`, nowMs: NOW });
      }
      recordNight(db, {
        cycleId: "week-edits", pass: weekly(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: { gaps: { dimensions: [{ id: seeded.id, score: 1, note: "Close enough.", supportRefs: ["m:morning"] }], edits: [
          { op: "add", name: "Ninth", question: "Too many?", reason: "I want another." },
          { op: "rename", id: seeded.id, name: "Knowing Alex", question: "Do I really know what matters to him right now, or am I assuming?", reason: "Clearer name." },
          { op: "retire", id: seeded.id, reason: "It no longer pulls." },
        ] } },
      });
      const listed = listGrowthDimensions(db);
      expect(listed.dimensions.filter((row) => row.status === "active")).toHaveLength(7);
      expect(listed.dimensions.find((row) => row.id === seeded.id)?.status).toBe("retired");
      expect(listed.history.some((row) => row.op === "add" && row.reason === "I want another.")).toBe(true);
      expect(revertAshleyDimensionEdit(db, { dimensionId: seeded.id, nowMs: NOW + 1 }).reverted).toBe(true);
      expect(listGrowthDimensions(db).dimensions.find((row) => row.id === seeded.id)?.status).toBe("active");
    } finally { db.close(); }
  });

  it("forgets gap notes and history the way other growth rows are redacted", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:morning");
      const seeded = seedGrowthDimension(db, { name: "Grounded initiative", question: "Did what I started come from something I actually care about?", nowMs: NOW });
      recordNight(db, {
        cycleId: "week-forget", pass: weekly(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: { gaps: { edits: [{ op: "rename", id: seeded.id, name: "Grounded initiative", question: "secret-phrase stays out", reason: "secret-phrase" }], dimensions: [
          { id: seeded.id, score: 2, note: "secret-phrase in the note", supportRefs: ["m:morning"] },
        ] } },
      });
      applyV021Forget(db, { topic: "secret-phrase", nowMs: NOW + 5 });
      expect(db.prepare("SELECT note FROM growth_gap_scores").get()).toEqual({ note: null });
      const history = db.prepare("SELECT reason, after_json FROM growth_dimension_history WHERE actor='ashley'").all() as Array<{ reason: string; after_json: string }>;
      expect(history.every((row) => row.reason === null || !row.reason.includes("secret-phrase"))).toBe(true);
      expect(history.every((row) => !String(row.after_json ?? "").includes("secret-phrase"))).toBe(true);
    } finally { db.close(); }
  });

  it("writes no gap rows when the weekly pass fails partway", () => {
    const db = openTestSidecar();
    try {
      memory(db, "m:morning");
      const seeded = seedGrowthDimension(db, { name: "Reflective calibration", question: "Did I keep apart what I know, what I guess and what I'm unsure of?", nowMs: NOW });
      expect(() => recordNight(db, {
        cycleId: "week-fail", pass: weekly(), timeZone: ZONE, dataClassification: "ordinary", nowMs: NOW,
        claim: { narrative: "A week.", gaps: { dimensions: [
          { id: seeded.id, score: 0, note: "Going well.", supportRefs: ["m:morning"] },
          { id: seeded.id, score: 1, note: "Duplicate id must roll back.", supportRefs: ["m:morning"] },
        ] } },
      })).toThrow(/growth_gap_partial/);
      expect(db.prepare("SELECT count(*) AS n FROM growth_gap_scores").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) AS n FROM self_narratives").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
});

import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { buildThoughtInput } from "../thought/input.js";
import type { AwakePass } from "./inner-pass.js";
import { buildInnerAgenda } from "./agenda.js";import { recordLessons } from "../../teach/lessons.js";


const NOW = 1_700_000_000_000;
const pass: AwakePass = { kind: "awake", slot: 1, sinceMs: NOW - 60_000 };

function journal(
  db: ReturnType<typeof openTestSidecar>,
  row: { id: string; pass: string; activity: string; at: number; forgotten?: number; lineage?: string },
): void {
  db.prepare(
    `INSERT INTO activity_journal
       (entry_id, conversation_id, cycle_id, pass_kind, activity, entry, read_refs_json, interests_json, spoke, data_classification, created_at_ms, forgotten_at_ms, channel, lineage_class)
     VALUES (?, 'dm:owner', ?, ?, ?, 'note', '[]', '[]', 0, 'ordinary', ?, ?, 'discord', ?)`,
  ).run(row.id, `cycle-${row.id}`, row.pass, row.activity, row.at, row.forgotten ?? null, row.lineage ?? "current");
}

describe("AWAKE agenda facts", () => {
  it("offers at most two lessons she has not taken home, and omits the list when there are none", () => {
    const db = openTestSidecar();
    try {
      expect(buildInnerAgenda(db, pass, NOW).lessons).toBeUndefined();
      recordLessons(db, { cycleId: "teach-a1", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: NOW - 3_000,
        claims: [{ what: "one" }, { what: "two" }, { what: "three" }] });
      expect(buildInnerAgenda(db, pass, NOW).lessons?.map((lesson) => lesson.what)).toEqual(["one", "two"]);
    } finally { db.close(); }
  });

  it("counts only the newest consecutive awake rests", () => {
    const db = openTestSidecar();
    try {
      journal(db, { id: "forgotten", pass: "awake", activity: "rest", at: 20, forgotten: 21 });
      journal(db, { id: "undone", pass: "awake", activity: "rest", at: 19, lineage: "undone" });
      journal(db, { id: "rest-new", pass: "awake", activity: "rest", at: 18 });
      journal(db, { id: "night", pass: "night", activity: "rest", at: 16 });
      journal(db, { id: "afterglow", pass: "afterglow", activity: "rest", at: 15 });
      journal(db, { id: "rest-mid", pass: "awake", activity: "rest", at: 14 });
      journal(db, { id: "think", pass: "awake", activity: "think", at: 10 });
      journal(db, { id: "old-rest", pass: "awake", activity: "rest", at: 5 });
      expect(buildInnerAgenda(db, pass, NOW).restStreak).toBe(2);
    } finally { db.close(); }
  });

  it("reports milliseconds since the newest Owner row, or null when there is none", () => {
    const db = openTestSidecar();
    try {
      expect(buildInnerAgenda(db, pass, NOW).sinceOwnerMs).toBeNull();
      appendOwnerUtterance(db, { conversationId: "dm:owner", text: "earlier", discordMessageIds: ["m1"], nowMs: NOW - 5_000 });
      appendOwnerUtterance(db, { conversationId: "dm:other", text: "later", discordMessageIds: ["m2"], nowMs: NOW - 1_500 });
      expect(buildInnerAgenda(db, pass, NOW).sinceOwnerMs).toBe(1_500);
    } finally { db.close(); }
  });

  it("carries both facts on an AWAKE ThoughtInput agenda", () => {
    const db = openTestSidecar();
    try {
      journal(db, { id: "rest-1", pass: "awake", activity: "rest", at: 2 });
      appendOwnerUtterance(db, { conversationId: "dm:owner", text: "hello", discordMessageIds: ["m1"], nowMs: NOW - 2_000 });
      const cycle = admitTestCycle(db, { conversationId: "dm:owner", triggerKind: "idle_opportunity", triggerRef: "awake", occupantId: "doc", nowMs: NOW });
      const agenda = buildInnerAgenda(db, pass, NOW);
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: "",
        constitution: { constitutional: ["truth first"], stableSelf: ["curious"] },
        capabilityReality: { vision: false, attachmentText: false, conversationalRead: false, webSearch: false, canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false, canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false, approvedProjectIds: [] },
        workingContext: [],
        occupancy: [],
        learnedSelfSlice: { dispositions: [], interests: [] },
        innerPass: { kind: "awake", agenda },
      });
      expect(input.innerPass).toMatchObject({ kind: "awake", agenda: { restStreak: 1, sinceOwnerMs: 2_000 } });
    } finally { db.close(); }
  });
});

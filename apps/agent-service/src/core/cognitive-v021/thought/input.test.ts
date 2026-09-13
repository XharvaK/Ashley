import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../test-support.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import type { CapabilityReality, IdentitySlice, MindOccupancy, WorkingContextItem } from "../types.js";
import { buildThoughtInput, frontierAwareEvidenceSelection } from "./input.js";
import { appendCycleLogIds, getCycle } from "../cycle/inbox.js";
import {
  getActiveDeferredFrontier,
  insertDeferredFrontierRecord,
} from "../frontier/ledger.js";

const identity: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capability: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
  canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: ["project-ashley"],
};

function makeInput(db: ReturnType<typeof openTestSidecar>, cycle: ReturnType<typeof admitTestCycle>, overrides: Partial<Parameters<typeof buildThoughtInput>[0]> = {}) {
  return buildThoughtInput({
    sidecar: db,
    cycle,
    triggerText: "continue the unresolved thread",
    constitution: identity,
    capabilityReality: capability,
    workingContext: [],
    occupancy: [],
    learnedSelfSlice: { dispositions: [], interests: [] },
    ...overrides,
  });
}

function openFrontier(
  db: ReturnType<typeof openTestSidecar>,
  cycle: ReturnType<typeof admitTestCycle>,
  latestEvidenceRowId: string,
  composeLogIds: string[],
) {
  const updatedCycle = appendCycleLogIds(db, cycle.cycleId, composeLogIds, 100);
  insertDeferredFrontierRecord(db, {
    frontierId: `frontier-${cycle.cycleId}`,
    conversationId: cycle.conversationId,
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    nextEligibleAtMs: 200,
    latestEvidenceRowId,
    nowMs: 100,
  });
  return { cycle: updatedCycle, frontier: getActiveDeferredFrontier(db, cycle.conversationId) };
}

describe("v0.2.1 ThoughtInput assembly", () => {
  it("uses one coherent selected-source package for input and currentness", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-coherent-sources",
        conversationId: "thread-coherent-sources",
        triggerKind: "owner_message",
        triggerRef: "owner-ref",
        occupantId: "doc",
        nowMs: 1,
      });
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES ('concern-selected', ?, 'selected', '[]', '{}', NULL, 'active', 'selected-v1', 'seed')`,
      ).run(cycle.conversationId);
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES ('concern-unrelated', ?, 'unrelated', '[]', '{}', NULL, 'resolved', 'unrelated-v1', 'seed')`,
      ).run(cycle.conversationId);
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, 'concern-selected', 'active', 10, 'seed', 2)`,
      ).run(cycle.conversationId);

      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        constitution: identity,
        capabilityReality: capability,
        learnedSelfSlice: { dispositions: [], interests: [] },
      });
      const source = (input as any).sourceCurrentness;

      expect(input.occupancy).toEqual([
        expect.objectContaining({ concernId: "concern-selected", priority: 10 }),
      ]);
      expect(input.concernSnapshots).toEqual({ "concern-selected": "selected-v1" });
      expect(source.workingContextOrder).toEqual([]);
      expect(source.occupancySelection).toMatchObject({
        limit: 8,
        selected: [expect.objectContaining({ concernId: "concern-selected" })],
      });
      expect(source.concernDependencies).toMatchObject({
        "concern-selected": expect.objectContaining({ snapshotHash: "selected-v1" }),
      });
      expect(source.concernDependencies).not.toHaveProperty("concern-unrelated");
    } finally {
      db.close();
    }
  });

  it("keeps the always-on last twelve turns, compact occupancy, and trigger terms", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message",
        triggerRef: "owner-20", occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      for (let index = 0; index < 20; index++) {
        appendOwnerUtterance(db, {
          conversationId: "thread-1", text: index === 0 ? "turn 0 HY19 background discussion" : `turn ${index} HY${index}`,
          discordMessageIds: [`discord-${index}`], nowMs: index + 1,
        });
      }
      const workingContext: WorkingContextItem[] = Array.from({ length: 100 }, (_, index) => ({
        id: `wc-${index}`, conversationId: "thread-1", type: "topic", text: `context-${index}`,
        concernId: null, sourceTurnIds: [], status: "active", supersedesId: null, updatedGeneration: 1,
      }));
      const occupancy: MindOccupancy[] = Array.from({ length: 12 }, (_, index) => ({
        conversationId: "thread-1", concernId: `concern-${index}`, status: "active", priority: index,
        updatedCycle: cycle.cycleId, updatedGeneration: 1,
      }));
      const derived = openDerivedStore(":memory:");
      derived.reconcile(db);
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: "Explain HY19 carefully",
        constitution: identity,
        capabilityReality: capability,
        workingContext,
        occupancy,
        learnedSelfSlice: { dispositions: [], interests: [] },
        derivedStore: derived,
      });
      expect(input.rawConversation).toHaveLength(12);
      expect(input.rawConversation.at(-1)?.text).toBe("turn 19 HY19");
      expect(input.workingContext).toHaveLength(100);
      expect(input.occupancy).toHaveLength(8);
      expect(input.occupancy[0]?.concernId).toBe("concern-0");
      expect(input.retrieval.request.triggerTerms).toEqual(expect.arrayContaining(["explain", "hy19", "carefully"]));
      expect(input.retrieval.hits).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceStore: "conversation_log" }),
      ]));
      derived.close();
    } finally {
      db.close();
    }
  });

  it("does not treat an ephemeral workspace note as a persisted Thought input field", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "x", nowMs: 1 });
      const input = buildThoughtInput({
        sidecar: db, cycle, constitution: identity, capabilityReality: capability,
        workingContext: [], occupancy: [], learnedSelfSlice: { dispositions: [], interests: [] },
      });
      expect(input).not.toHaveProperty("workspace");
      expect(makeThoughtDraft).toBeTypeOf("function");
    } finally {
      db.close();
    }
  });

  it("includes an active frontier leader outside the ordinary twelve-row window", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "frontier-thread", triggerKind: "owner_message", triggerRef: "leader", nowMs: 1 });
      const rows = Array.from({ length: 20 }, (_, index) => appendOwnerUtterance(db, {
        conversationId: "frontier-thread", text: index === 0 ? "frontier leader" : `follower ${index}`,
        discordMessageIds: [`frontier-${index}`], nowMs: index + 1,
      }));
      const { cycle: resumedCycle } = openFrontier(db, cycle, rows[0]!.rowId, [rows[0]!.rowId]);

      const input = makeInput(db, resumedCycle);

      expect(input.rawConversation.map((row) => row.rowId)).toContain(rows[0]!.rowId);
      expect(input.rawConversation.at(-1)?.text).toBe("follower 19");
    } finally {
      db.close();
    }
  });

  it("includes the leader and all active frontier followers without concatenating turns", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "frontier-followers", triggerKind: "owner_message", triggerRef: "leader", nowMs: 1 });
      const rows = Array.from({ length: 30 }, (_, index) => appendOwnerUtterance(db, {
        conversationId: "frontier-followers", text: `frontier message ${index}`,
        discordMessageIds: [`frontier-followers-${index}`], nowMs: index + 1,
      }));
      const required = rows.slice(0, 4).map((row) => row.rowId);
      const { cycle: resumedCycle } = openFrontier(db, cycle, rows[3]!.rowId, required);

      const input = makeInput(db, resumedCycle);
      const selected = new Set(input.rawConversation.map((row) => row.rowId));

      expect(required.every((rowId) => selected.has(rowId))).toBe(true);
      expect(input.rawConversation.filter((row) => required.includes(row.rowId))).toHaveLength(4);
      expect(input.rawConversation.map((row) => row.text)).not.toContain(required.join(" "));
    } finally {
      db.close();
    }
  });

  it("preserves every current identity for a frontier larger than twenty-four turns", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "large-frontier", triggerKind: "owner_message", triggerRef: "large", nowMs: 1 });
      const rows = Array.from({ length: 40 }, (_, index) => appendOwnerUtterance(db, {
        conversationId: "large-frontier", text: `large frontier message ${index}`,
        discordMessageIds: [`large-frontier-${index}`], nowMs: index + 1,
      }));
      const required = rows.slice(0, 30).map((row) => row.rowId);
      const { cycle: resumedCycle } = openFrontier(db, cycle, rows[29]!.rowId, required);

      const input = makeInput(db, resumedCycle);

      expect(input.rawConversation).toHaveLength(40);
      expect(new Set(input.rawConversation.map((row) => row.rowId)).size).toBe(40);
      expect(input.rawConversation.map((row) => row.rowId)).toEqual(rows.map((row) => row.rowId));
      expect(input.conversationSelection?.frontierIncludedIds).toEqual(
        expect.arrayContaining(required),
      );
    } finally {
      db.close();
    }
  });

  it("resolves an active frontier obligation to the latest edited evidence version", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "edited-frontier", triggerKind: "owner_message", triggerRef: "edited", nowMs: 1 });
      const original = appendOwnerUtterance(db, {
        conversationId: "edited-frontier", text: "original leader", discordMessageIds: ["edited-1"], nowMs: 1,
      });
      const edited = appendOwnerUtterance(db, {
        conversationId: "edited-frontier", text: "latest leader", discordMessageIds: ["edited-1"], editOfRowId: original.rowId, nowMs: 2,
      });
      const { cycle: resumedCycle } = openFrontier(db, cycle, original.rowId, [original.rowId]);

      const input = makeInput(db, resumedCycle);

      expect(input.rawConversation.map((row) => row.rowId)).toContain(edited.rowId);
      expect(input.rawConversation.map((row) => row.rowId)).not.toContain(original.rowId);
      expect(input.rawConversation.map((row) => row.text)).toContain("latest leader");
      expect(input.rawConversation.map((row) => row.text)).not.toContain("original leader");
    } finally {
      db.close();
    }
  });

  it("retains the authoritative current row identity for an edited Owner trigger", () => {
    const db = openTestSidecar();
    try {
      const original = appendOwnerUtterance(db, {
        conversationId: "edited-trigger",
        text: "original trigger",
        discordMessageIds: ["edited-trigger-1"],
        nowMs: 1,
      });
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-edited-trigger",
        conversationId: "edited-trigger",
        triggerKind: "owner_message",
        triggerRef: original.rowId,
        nowMs: 2,
      });
      const edited = appendOwnerUtterance(db, {
        conversationId: "edited-trigger",
        text: "authoritative current trigger",
        discordMessageIds: ["edited-trigger-1"],
        editOfRowId: original.rowId,
        nowMs: 3,
      });

      const input = makeInput(db, cycle, { triggerEvidence: original });

      expect(input.rawConversation.map((row) => row.rowId)).toContain(edited.rowId);
      expect(input.rawConversation.map((row) => row.rowId)).not.toContain(original.rowId);
      expect(input.conversationSelection?.currentTriggerRowId).toBe(edited.rowId);
    } finally {
      db.close();
    }
  });

  it("preserves sanitized forgotten evidence rather than inventing replacement text", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "redacted-frontier", triggerKind: "owner_message", triggerRef: "redacted", nowMs: 1 });
      const redacted = appendOwnerUtterance(db, {
        conversationId: "redacted-frontier", text: "[redacted]", sourceStatus: "redacted", discordMessageIds: ["redacted-1"], nowMs: 1,
      });
      const { cycle: resumedCycle } = openFrontier(db, cycle, redacted.rowId, [redacted.rowId]);

      const input = makeInput(db, resumedCycle);

      expect(input.rawConversation).toContainEqual(expect.objectContaining({ rowId: redacted.rowId, text: "[redacted]" }));
      expect(input.rawConversation.map((row) => row.text)).not.toContain("forgotten evidence");
    } finally {
      db.close();
    }
  });

  it("returns to ordinary recency after a frontier is resolved or exhausted", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "terminal-frontier", triggerKind: "owner_message", triggerRef: "terminal", nowMs: 1 });
      const rows = Array.from({ length: 20 }, (_, index) => appendOwnerUtterance(db, {
        conversationId: "terminal-frontier", text: `terminal message ${index}`,
        discordMessageIds: [`terminal-${index}`], nowMs: index + 1,
      }));
      const { cycle: resumedCycle, frontier } = openFrontier(db, cycle, rows[0]!.rowId, [rows[0]!.rowId]);
      db.prepare("UPDATE deferred_reactive_frontiers SET state = 'resolved' WHERE frontier_id = ?").run(frontier?.frontierId ?? "");

      expect(getActiveDeferredFrontier(db, cycle.conversationId)).toBeNull();
      const input = makeInput(db, getCycle(db, resumedCycle.cycleId)!);
      expect(input.rawConversation).toHaveLength(12);
      expect(input.rawConversation.map((row) => row.rowId)).not.toContain(rows[0]!.rowId);
    } finally {
      db.close();
    }
  });

  it("does not retain exhausted frontier obligations forever", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "exhausted-frontier", triggerKind: "owner_message", triggerRef: "exhausted", nowMs: 1 });
      const rows = Array.from({ length: 20 }, (_, index) => appendOwnerUtterance(db, {
        conversationId: "exhausted-frontier", text: `exhausted message ${index}`,
        discordMessageIds: [`exhausted-${index}`], nowMs: index + 1,
      }));
      const { cycle: resumedCycle, frontier } = openFrontier(db, cycle, rows[0]!.rowId, [rows[0]!.rowId]);
      db.prepare("UPDATE deferred_reactive_frontiers SET state = 'exhausted' WHERE frontier_id = ?").run(frontier?.frontierId ?? "");

      const input = makeInput(db, getCycle(db, resumedCycle.cycleId)!);

      expect(input.rawConversation).toHaveLength(12);
      expect(input.rawConversation.map((row) => row.rowId)).not.toContain(rows[0]!.rowId);
    } finally {
      db.close();
    }
  });

  it("fails closed when active frontier evidence cannot be recovered", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "missing-frontier", triggerKind: "owner_message", triggerRef: "missing", nowMs: 1 });
      const { cycle: resumedCycle } = openFrontier(db, cycle, "missing-evidence", ["missing-evidence"]);

      expect(() => makeInput(db, resumedCycle)).toThrowError("active_frontier_required_evidence_missing:missing-evidence");
    } finally {
      db.close();
    }
  });

  it("does not populate omittedEvidenceIds for historical turns excluded merely by recency", () => {
    const db = openTestSidecar();
    try {
      const rows = Array.from({ length: 25 }, (_, index) =>
        appendOwnerUtterance(db, {
          conversationId: "thread-recency",
          text: `historical turn ${index}`,
          discordMessageIds: [`recency-msg-${index}`],
          nowMs: index + 1,
        }),
      );
      const currentTrigger = rows.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-recency",
        conversationId: "thread-recency",
        triggerKind: "owner_message",
        triggerRef: currentTrigger.rowId,
        nowMs: 100,
      });

      const selection = frontierAwareEvidenceSelection(db, "thread-recency", {
        triggerEvidence: currentTrigger,
      });
      expect(selection.selectedEvidence).toHaveLength(12);
      expect(selection.currentTriggerRowId).toBe(currentTrigger.rowId);
      // RECENCY_NOT_SELECTED must not be treated as a budget omission
      expect(selection.omittedEvidenceIds).toEqual([]);

      const input = makeInput(db, cycle, { triggerEvidence: currentTrigger });
      expect(input.rawConversation).toHaveLength(12);
      expect(input.conversationSelection?.currentTriggerRowId).toBe(currentTrigger.rowId);
      expect(input.conversationSelection?.omittedEvidenceIds).toEqual([]);
    } finally {
      db.close();
    }
  });
});


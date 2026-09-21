import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../test-support.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import { appendEvidenceInTransaction, appendOwnerUtterance, listConversationEvidence } from "../evidence/conversation-log.js";
import type { CapabilityReality, IdentitySlice, MindOccupancy, WorkingContextItem } from "../types.js";
import { buildThoughtInput, filterCapabilityReality, frontierAwareEvidenceSelection } from "./input.js";
import { appendCycleLogIds, getCycle } from "../cycle/inbox.js";
import {
  getActiveDeferredFrontier,
  insertDeferredFrontierRecord,
} from "../frontier/ledger.js";

const identity: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capability: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
  canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: true, canOfferPatchExport: false,
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
  it("keeps authenticated Owner authority while binding evidence to the room audience", () => {
    const db = openTestSidecar();
    try {
      const roomId = "room:owner-guild:owner-channel";
      const cycle = admitTestCycle(db, {
        conversationId: roomId,
        triggerKind: "owner_message",
        triggerRef: "owner-room-input",
        occupantId: "doc",
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(db, {
        conversationId: roomId,
        text: "room-visible Owner request",
        discordMessageIds: ["owner-room-input-message"],
        nowMs: 2,
        speakerPrincipalId: "doc",
        speakerKind: "owner",
        location: { kind: "room", guildId: "owner-guild", channelId: "owner-channel" },
        audienceAtCapture: "room",
      });

      const ownerInput = makeInput(db, cycle, {
        triggerEvidence: evidence,
        rawConversation: [evidence],
        audience: { kind: "room", roomId },
        authenticatedOwner: true,
      });
      expect(ownerInput.rawConversation).toEqual([expect.objectContaining({
        speakerPrincipalId: "doc",
        speakerKind: "owner",
        audienceAtCapture: "room",
        location: { kind: "room", guildId: "owner-guild", channelId: "owner-channel" },
      })]);
      expect(ownerInput.capabilityReality).toMatchObject({
        conversationalRead: true,
        canOfferProjectInspection: true,
        canOfferInquiry: true,
      });

      const externalInput = makeInput(db, cycle, {
        triggerEvidence: evidence,
        rawConversation: [evidence],
        audience: { kind: "room", roomId },
      });
      expect(externalInput.capabilityReality).toMatchObject({
        conversationalRead: false,
        canOfferProjectInspection: false,
        canOfferInquiry: false,
      });
    } finally {
      db.close();
    }
  });

  it("removes operator project IDs when inspection affordances are filtered from non-Owner input", () => {
    const filtered = filterCapabilityReality({
      ...capability,
      operationCapabilities: [{
        operationKind: "project.read_file",
        semanticClass: "observation",
        family: "project_inspection",
        readOnly: true,
        requiresProject: true,
        available: true,
        requiredRequestFields: ["projectId", "path"],
        optionalRequestFields: [],
        operatorBoundRequestFields: [],
        authorizedProjectIds: ["project-ashley"],
      }],
      semanticObservations: [{
        operationKind: "concern.inspect",
        semanticClass: "observation",
        readOnly: true,
        available: true,
      }],
    }, { kind: "room", roomId: "room:external" }, [], false);

    expect(filtered.approvedProjectIds).toEqual([]);
    expect(filtered.canOfferProjectInspection).toBe(false);
    expect(filtered.canOfferInquiry).toBe(false);
    expect(filtered.operationCapabilities).toEqual([expect.objectContaining({
      available: false,
      authorizedProjectIds: [],
    })]);
    expect(filtered.semanticObservations).toEqual([expect.objectContaining({
      operationKind: "concern.inspect",
      available: false,
    })]);
  });

  it("keeps concern.inspect unavailable on the authenticated-Owner room production path", () => {
    const ownerPrivateBuilt = filterCapabilityReality({
      ...capability,
      semanticObservations: [{
        operationKind: "concern.inspect",
        semanticClass: "observation",
        readOnly: true,
        available: true,
      }],
    }, { kind: "owner_private" }, [], false);
    expect(ownerPrivateBuilt.semanticObservations).toEqual([expect.objectContaining({
      operationKind: "concern.inspect",
      available: true,
    })]);
    const roomProjected = filterCapabilityReality(
      ownerPrivateBuilt,
      { kind: "room", roomId: "room:owner-guild:owner-channel" },
      [],
      true,
    );
    expect(roomProjected.semanticObservations).toEqual([expect.objectContaining({
      operationKind: "concern.inspect",
      available: false,
    })]);
    expect(roomProjected.reachability?.reasons).toMatchObject({
      "concern.inspect": "another_audience_only",
    });
    expect(roomProjected.canOfferProjectInspection).toBe(true);
  });

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
        limit: 12,
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
      expect(input.occupancy).toHaveLength(12);
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

  it("retains the compose-log obligation ref best-effort after a frontier resolves", () => {
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
      // Ordinary recency (12) plus the carried obligation ref outside the window.
      expect(input.rawConversation).toHaveLength(13);
      expect(input.rawConversation.map((row) => row.rowId)).toContain(rows[0]!.rowId);
    } finally {
      db.close();
    }
  });

  it("retains the compose-log obligation ref best-effort after a frontier exhausts", () => {
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

      expect(input.rawConversation).toHaveLength(13);
      expect(input.rawConversation.map((row) => row.rowId)).toContain(rows[0]!.rowId);
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

describe("E2a conversation recency loss honesty", () => {
  function seedOwnerTurns(
    db: ReturnType<typeof openTestSidecar>,
    conversationId: string,
    count: number,
    startMs = 1,
  ) {
    return Array.from({ length: count }, (_, index) => appendOwnerUtterance(db, {
      conversationId,
      text: `e2a turn ${index}`,
      discordMessageIds: [`e2a-${conversationId}-${index}`],
      nowMs: startMs + index,
    }));
  }

  it("omits the count when eligible history fits the window (A)", () => {
    const db = openTestSidecar();
    try {
      const rows = seedOwnerTurns(db, "thread-e2a-complete", 5);
      const currentTrigger = rows.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-complete",
        conversationId: "thread-e2a-complete",
        triggerKind: "owner_message",
        triggerRef: currentTrigger.rowId,
        nowMs: 100,
      });

      const input = makeInput(db, cycle, { triggerEvidence: currentTrigger });
      expect(input.rawConversation).toHaveLength(5);
      expect(input.conversationSelection?.currentTriggerRowId).toBe(currentTrigger.rowId);
      expect(input.conversationSelection?.recencyOmittedCount).toBeUndefined();
      expect(input.conversationSelection?.omittedEvidenceIds).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("reports the exact eligible omission on ordinary recency loss without exposing IDs (B+N)", () => {
    const db = openTestSidecar();
    try {
      const rows = seedOwnerTurns(db, "thread-e2a-loss", 25);
      const currentTrigger = rows.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-loss",
        conversationId: "thread-e2a-loss",
        triggerKind: "owner_message",
        triggerRef: currentTrigger.rowId,
        nowMs: 100,
      });

      const selection = frontierAwareEvidenceSelection(db, "thread-e2a-loss", {
        triggerEvidence: currentTrigger,
      });
      expect(selection.selectedEvidence).toHaveLength(12);
      expect(selection.recencyExcludedEvidence).toHaveLength(13);
      expect(selection.recencyExcludedEvidence.map((row) => row.rowId)).toEqual(
        rows.slice(0, 13).map((row) => row.rowId),
      );

      const input = makeInput(db, cycle, { triggerEvidence: currentTrigger });
      expect(input.rawConversation).toHaveLength(12);
      expect(input.rawConversation.map((row) => row.rowId)).toEqual(
        rows.slice(-12).map((row) => row.rowId),
      );
      expect(input.conversationSelection?.recencyOmittedCount).toBe(13);
      expect(input.conversationSelection?.omittedEvidenceIds).toEqual([]);
      // No recency-excluded row ID may appear anywhere in the selection metadata.
      const selectionWire = JSON.stringify(input.conversationSelection);
      for (const excluded of rows.slice(0, 13)) {
        expect(selectionWire).not.toContain(excluded.rowId);
      }
    } finally {
      db.close();
    }
  });

  it("does not count the current trigger selected from outside the window (C)", () => {
    const db = openTestSidecar();
    try {
      const rows = seedOwnerTurns(db, "thread-e2a-trigger", 25);
      const oldTrigger = rows[0]!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-trigger",
        conversationId: "thread-e2a-trigger",
        triggerKind: "owner_message",
        triggerRef: oldTrigger.rowId,
        nowMs: 100,
      });

      const input = makeInput(db, cycle, { triggerEvidence: oldTrigger });
      // Last-12 recency plus the augmented trigger row outside the window.
      expect(input.rawConversation).toHaveLength(13);
      expect(input.rawConversation.map((row) => row.rowId)).toContain(oldTrigger.rowId);
      expect(input.conversationSelection?.currentTriggerRowId).toBe(oldTrigger.rowId);
      expect(input.conversationSelection?.recencyOmittedCount).toBe(12);
    } finally {
      db.close();
    }
  });

  it("does not count protected frontier obligation rows (D)", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, { conversationId: "e2a-frontier", triggerKind: "owner_message", triggerRef: "e2a-frontier", nowMs: 1 });
      const rows = seedOwnerTurns(db, "e2a-frontier", 20);
      const { cycle: resumedCycle } = openFrontier(db, cycle, rows[0]!.rowId, [rows[0]!.rowId]);

      const input = makeInput(db, resumedCycle);
      // Ordinary recency (12) plus the carried obligation ref outside the window.
      expect(input.rawConversation).toHaveLength(13);
      expect(input.rawConversation.map((row) => row.rowId)).toContain(rows[0]!.rowId);
      expect(input.conversationSelection?.frontierIncludedIds).toContain(rows[0]!.rowId);
      expect(input.conversationSelection?.recencyOmittedCount).toBe(7);
    } finally {
      db.close();
    }
  });

  it("counts zero for lifecycle-rejected older rows and leaks nothing (E)", () => {
    const db = openTestSidecar();
    const conversationId = "social-dm-e2a";
    try {
      const ownerRows = Array.from({ length: 15 }, (_, index) => appendOwnerUtterance(db, {
        conversationId,
        text: `e2a owner-private ${index}`,
        discordMessageIds: [`e2a-owner-${index}`],
        nowMs: index + 1,
      }));
      const externalRows = Array.from({ length: 10 }, (_, index) => appendEvidenceInTransaction(db, "external_dialog", {
        conversationId,
        text: `same-dm context ${index}`,
        speakerKind: "external_human",
        speakerPrincipalId: "person-9",
        location: { kind: "external_dm", principalId: "person-9", channelId: "dm-channel-9" },
        audienceAtCapture: "dm",
        discordMessageIds: [`e2a-ext-${index}`],
        sentAtMs: 16 + index,
        nowMs: 16 + index,
      }));
      const lastExternal = externalRows.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-dm",
        conversationId,
        triggerKind: "owner_message",
        triggerRef: lastExternal.rowId,
        occupantId: "doc",
        nowMs: 100,
      });

      const input = makeInput(db, cycle, {
        triggerEvidence: lastExternal,
        audience: { kind: "dm", principalId: "person-9" },
      });
      // The 15 owner-private rows are rejected by the existing lifecycle
      // filterEvidence for this audience; the 10 eligible rows fit the
      // window, so there is no known eligible omission.
      expect(input.rawConversation).toHaveLength(10);
      expect(input.conversationSelection?.recencyOmittedCount).toBeUndefined();
      const wire = JSON.stringify(input);
      for (const owner of ownerRows) {
        expect(wire).not.toContain(owner.rowId);
      }
      expect(wire).not.toContain("e2a owner-private 0");
    } finally {
      db.close();
    }
  });

  it("does not narrow Owner-private eligibility (F)", () => {
    const db = openTestSidecar();
    const conversationId = "social-dm-e2a-owner";
    try {
      Array.from({ length: 15 }, (_, index) => appendOwnerUtterance(db, {
        conversationId,
        text: `e2a owner-private ${index}`,
        discordMessageIds: [`e2a-f-owner-${index}`],
        nowMs: index + 1,
      }));
      const externalRows = Array.from({ length: 10 }, (_, index) => appendEvidenceInTransaction(db, "external_dialog", {
        conversationId,
        text: `same-dm context ${index}`,
        speakerKind: "external_human",
        speakerPrincipalId: "person-9",
        location: { kind: "external_dm", principalId: "person-9", channelId: "dm-channel-9" },
        audienceAtCapture: "dm",
        discordMessageIds: [`e2a-f-ext-${index}`],
        sentAtMs: 16 + index,
        nowMs: 16 + index,
      }));
      const lastExternal = externalRows.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-owner",
        conversationId,
        triggerKind: "owner_message",
        triggerRef: lastExternal.rowId,
        occupantId: "doc",
        nowMs: 100,
      });

      // Under owner_private the existing filter passes every row, so all 13
      // recency-excluded rows count — E2a adds no stricter policy of its own.
      const input = makeInput(db, cycle, { triggerEvidence: lastExternal });
      expect(input.rawConversation).toHaveLength(12);
      expect(input.conversationSelection?.recencyOmittedCount).toBe(13);
    } finally {
      db.close();
    }
  });

  it("derives the count from the selector source set without a second store read (G)", () => {
    const db = openTestSidecar();
    const conversationId = "thread-e2a-sameread";
    try {
      seedOwnerTurns(db, conversationId, 25);
      const snapshot = listConversationEvidence(db, conversationId);
      expect(snapshot).toHaveLength(25);
      const currentTrigger = snapshot.at(-1)!;
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-e2a-sameread",
        conversationId,
        triggerKind: "owner_message",
        triggerRef: currentTrigger.rowId,
        nowMs: 100,
      });
      // Remove every durable row: any second store read would now see nothing.
      db.prepare("DELETE FROM conversation_evidence_log WHERE conversation_id = ?").run(conversationId);

      const input = makeInput(db, cycle, {
        triggerEvidence: currentTrigger,
        rawConversation: snapshot,
      });
      expect(input.rawConversation).toHaveLength(12);
      expect(input.conversationSelection?.recencyOmittedCount).toBe(13);
    } finally {
      db.close();
    }
  });

  it("discloses loss on trigger-less/frontier-less cycles and stays absent when complete (H+I)", () => {
    const db = openTestSidecar();
    try {
      seedOwnerTurns(db, "thread-e2a-idle-lossy", 25);
      const idleLossy = admitTestCycle(db, {
        cycleId: "cycle-e2a-idle-lossy",
        conversationId: "thread-e2a-idle-lossy",
        triggerKind: "idle_opportunity",
        triggerRef: "idle-lossy",
        nowMs: 100,
      });
      const lossy = makeInput(db, idleLossy);
      expect(lossy.conversationSelection).toBeDefined();
      expect(lossy.conversationSelection?.recencyOmittedCount).toBe(13);
      expect(lossy.conversationSelection?.currentTriggerRowId).toBeUndefined();
      expect(lossy.conversationSelection?.frontierIncludedIds).toEqual([]);

      seedOwnerTurns(db, "thread-e2a-idle-complete", 5);
      const idleComplete = admitTestCycle(db, {
        cycleId: "cycle-e2a-idle-complete",
        conversationId: "thread-e2a-idle-complete",
        triggerKind: "idle_opportunity",
        triggerRef: "idle-complete",
        nowMs: 100,
      });
      const complete = makeInput(db, idleComplete);
      expect(complete.rawConversation).toHaveLength(5);
      expect(complete.conversationSelection).toBeUndefined();
    } finally {
      db.close();
    }
  });
});


import { describe, expect, it } from "vitest";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { applyOccupancyDelta, listOccupancy } from "./occupancy.js";
import { captureThoughtSourcePackage } from "../thought/input.js";
import { DEFAULT_OCCUPANCY_COMPACT_K } from "../types.js";

describe("v0.2.1 mind occupancy", () => {
  it("stamps publication generation and rejects stale occupancy writers", () => {
    const db = openTestSidecar();
    try {
      applyOccupancyDelta(db, { op: "set", occupancy: {
        conversationId: "thread-generation", concernId: "concern-1", status: "active", priority: 9, updatedGeneration: 999,
      } }, { cycleId: "cycle-new", generation: 7 });
      applyOccupancyDelta(db, { op: "set", occupancy: {
        conversationId: "thread-generation", concernId: "concern-1", status: "resolved", priority: 1, updatedGeneration: 10_000,
      } }, { cycleId: "cycle-stale", generation: 6 });

      expect(listOccupancy(db, "thread-generation")).toEqual([
        expect.objectContaining({
          concernId: "concern-1",
          status: "active",
          priority: 9,
          updatedCycle: "cycle-new",
          updatedGeneration: 7,
        }),
      ]);
    } finally {
      db.close();
    }
  });

  it("retains an unanswered question across a distractor", () => {
    const db = openTestSidecar();
    try {
      applyOccupancyDelta(db, { op: "set", occupancy: {
        conversationId: "thread-1", concernId: "question-1", status: "active", priority: 9, updatedGeneration: 1,
      } }, { cycleId: "cycle-1", generation: 1 });
      applyOccupancyDelta(db, { op: "set", occupancy: {
        conversationId: "thread-1", concernId: "distractor", status: "active", priority: 1, updatedGeneration: 2,
      } }, { cycleId: "cycle-2", generation: 2 });
      expect(listOccupancy(db, "thread-1")).toEqual(expect.arrayContaining([
        expect.objectContaining({ concernId: "question-1", status: "active" }),
      ]));
    } finally {
      db.close();
    }
  });

  it("captures the top twelve occupancy rows through the live Thought source path", () => {
    const db = openTestSidecar();
    try {
      expect(DEFAULT_OCCUPANCY_COMPACT_K).toBe(12);
      const cycle = admitTestCycle(db, {
        conversationId: "thread-occupancy-k",
        triggerKind: "owner_message",
        triggerRef: "first",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      for (let index = 0; index < 15; index += 1) {
        applyOccupancyDelta(db, {
          op: "set",
          occupancy: {
            conversationId: cycle.conversationId,
            concernId: `concern-${index}`,
            status: "active",
            priority: index,
            updatedGeneration: index,
          },
        }, { cycleId: cycle.cycleId, generation: index + 1 });
      }
      const captured = captureThoughtSourcePackage({
        sidecar: db,
        cycle,
        constitution: { constitutional: ["truth"], stableSelf: ["careful"] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
          approvedProjectIds: [],
        },
      });
      expect(captured.occupancy).toHaveLength(12);
      expect(captured.occupancy.map((row) => row.concernId)).toEqual([
        "concern-14", "concern-13", "concern-12", "concern-11", "concern-10", "concern-9",
        "concern-8", "concern-7", "concern-6", "concern-5", "concern-4", "concern-3",
      ]);
      expect(captured.occupancy.map((row) => row.concernId)).not.toContain("concern-2");
    } finally {
      db.close();
    }
  });
});

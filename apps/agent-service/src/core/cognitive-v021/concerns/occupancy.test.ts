import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { applyOccupancyDelta, listOccupancy } from "./occupancy.js";

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
});

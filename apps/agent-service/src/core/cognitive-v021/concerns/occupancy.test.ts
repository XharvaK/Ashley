import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { applyOccupancyDelta, listOccupancy } from "./occupancy.js";

describe("v0.2.1 mind occupancy", () => {
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

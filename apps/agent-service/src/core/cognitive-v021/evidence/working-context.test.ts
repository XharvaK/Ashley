import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { applyWorkingContextDelta, listWorkingContext } from "./working-context.js";

describe("v0.2.1 Working Context", () => {
  it("supersedes a stale referent while preserving the original evidence", () => {
    const db = openTestSidecar();
    try {
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: {
          id: "referent-hy4", conversationId: "thread-1", type: "referent", text: "HY4",
          concernId: "concern-1", sourceTurnIds: ["turn-1"], status: "active", supersedesId: null,
        },
      }, { cycleId: "cycle-1", generation: 1 });
      applyWorkingContextDelta(db, {
        op: "supersede", id: "referent-hy4", replacement: {
          id: "referent-hy3", conversationId: "thread-1", type: "referent", text: "HY3",
          concernId: "concern-1", sourceTurnIds: ["turn-2"], status: "active", supersedesId: "referent-hy4",
        },
      }, { cycleId: "cycle-2", generation: 2 });
      expect(listWorkingContext(db, "thread-1")).toMatchObject([
        { id: "referent-hy3", text: "HY3", status: "active" },
      ]);
      expect(db.prepare("SELECT superseded FROM working_context_items WHERE id = 'referent-hy4'").get()).toMatchObject({ superseded: 1 });
    } finally {
      db.close();
    }
  });

  it("makes owner teaching available without admitting Memory", () => {
    const db = openTestSidecar();
    try {
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: {
          id: "teaching-1", conversationId: "thread-1", type: "owner_teaching", text: "HY3 is an LLM",
          concernId: null, sourceTurnIds: ["turn-2"], status: "active", supersedesId: null,
        },
      }, { cycleId: "cycle-2", generation: 2 });
      expect(listWorkingContext(db, "thread-1")).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "owner_teaching", text: "HY3 is an LLM" }),
      ]));
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });
});

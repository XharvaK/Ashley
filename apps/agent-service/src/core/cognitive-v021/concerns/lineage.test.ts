import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { applyConcernDelta, getConcern } from "./lineage.js";

describe("v0.2.1 concern lineage", () => {
  it("keeps one concern statement and updates its snapshot", () => {
    const db = openTestSidecar();
    try {
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-1", conversationId: "thread-1", statement: "What is HY3?",
          sourceTurnIds: ["turn-1"], dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          assertionKey: "hy3", status: "active",
        },
      }, { cycleId: "cycle-1", generation: 1 });
      const first = getConcern(db, "concern-1");
      expect(first?.statement).toBe("What is HY3?");
      applyConcernDelta(db, { op: "resolve", concernId: "concern-1" }, { cycleId: "cycle-2", generation: 2 });
      expect(getConcern(db, "concern-1")?.status).toBe("resolved");
      expect(db.prepare("SELECT COUNT(*) AS count FROM concerns WHERE concern_id = 'concern-1'").get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });
});

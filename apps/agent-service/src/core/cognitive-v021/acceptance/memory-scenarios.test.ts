import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { buildOwnerKnowledgeView } from "../memory/views.js";
import { buildLearnedSelfSlice } from "../identity/learned-self.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle } from "../test-support.js";
import { applyWorkingContextDelta, listWorkingContext } from "../evidence/working-context.js";
import { applyV021Forget } from "../memory/forget.js";

describe("v0.2.1 memory causal acceptance", () => {
  it("does not define a persistable AshleyBelief type", () => {
    const typesSource = readFileSync(fileURLToPath(new URL("../types.ts", import.meta.url)), "utf8");
    expect(typesSource).not.toContain("AshleyBelief");
  });

  it("preserves corrected owner evidence and admits only the Thought-authored claim", () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    try {
      const cycle = admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: "HY4", occupantId: "doc", nowMs: 1 });
      const first = appendOwnerUtterance(db, { conversationId: "thread-1", text: "HY4", discordMessageIds: ["m1"], nowMs: 2 });
      const correction = appendOwnerUtterance(db, { conversationId: "thread-1", text: "I meant HY3", discordMessageIds: ["m2"], nowMs: 3 });
      applyWorkingContextDelta(db, { op: "upsert", item: { id: "wc-old", conversationId: "thread-1", type: "referent", text: "HY4", concernId: "concern-1", sourceTurnIds: [first.rowId], status: "active", supersedesId: null } }, { cycleId: cycle.cycleId, generation: 1 });
      applyWorkingContextDelta(db, { op: "supersede", id: "wc-old", replacement: { id: "wc-new", conversationId: "thread-1", type: "owner_teaching", text: "HY3 is the corrected referent.", concernId: "concern-1", sourceTurnIds: [correction.rowId], status: "active", supersedesId: "wc-old" } }, { cycleId: cycle.cycleId, generation: 1 });
      upsertMemoryAssertion(db, { assertionKey: "owner:hy3", statement: "HY3 is the corrected referent.", memoryKind: "owner_world_claim", dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      expect(db.prepare("SELECT text FROM conversation_evidence_log ORDER BY created_at_ms").all()).toEqual([{ text: "HY4" }, { text: "I meant HY3" }]);
      expect(listWorkingContext(db, "thread-1")).toEqual([expect.objectContaining({ text: "HY3 is the corrected referent.", status: "active" })]);
      expect(buildOwnerKnowledgeView(db)).toEqual([expect.objectContaining({ assertionKey: "owner:hy3" })]);
    } finally {
      db.close();
    }
  });

  it("survives sidecar reopen and forget removes the source from all v021 readers", () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-cognitive-v021-memory-"));
    const path = join(directory, "sidecar.db");
    try {
      const first = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: { kind: "isolated" } });
      const cycle = admitTestCycle(first, { cycleId: "cycle-persist", conversationId: "thread-persist", generation: 1, triggerKind: "owner_message", triggerRef: "topic", occupantId: "doc", nowMs: 1 });
      const evidence = appendOwnerUtterance(first, { conversationId: "thread-persist", text: "persisted topic", discordMessageIds: ["persisted-1"], nowMs: 2 });
      applyWorkingContextDelta(first, { op: "upsert", item: { id: "wc-persist", conversationId: "thread-persist", type: "topic", text: "persisted topic", concernId: null, sourceTurnIds: [evidence.rowId], status: "active", supersedesId: null } }, { cycleId: cycle.cycleId, generation: cycle.generation });
      upsertMemoryAssertion(first, { assertionKey: "memory:persisted", statement: "persisted topic", memoryKind: "owner_world_claim", dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      first.close();

      const reopened = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: { kind: "isolated" } });
      expect(listWorkingContext(reopened, "thread-persist")).toHaveLength(1);
      expect(buildOwnerKnowledgeView(reopened)).toHaveLength(1);
      expect(buildLearnedSelfSlice(reopened)).toEqual({ dispositions: [], interests: [] });
      applyV021Forget(reopened, { topic: "persisted topic" });
      expect(listWorkingContext(reopened, "thread-persist")).toEqual([]);
      expect(buildOwnerKnowledgeView(reopened)).toEqual([]);
      reopened.close();
      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

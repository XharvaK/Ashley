import { describe, expect, it } from "vitest";
import { appendInboxEvent, getCycle } from "./inbox.js";
import { resolveOriginProfile } from "./origin-profile.js";
import { openTestSidecar } from "../test-support.js";

describe("self-change result private origin", () => {
  it("admits result as its own trigger instead of Owner dialogue", () => {
    const db = openTestSidecar();
    try {
      const event = appendInboxEvent(db, { id: "self-result", conversationId: "private-self", kind: "self_change_result", payload: { changesetId: "cs_fixture" }, createdAtMs: 1 });
      const cycle = getCycle(db, (event.payload as { cycleId: string }).cycleId)!;
      expect(cycle.triggerKind).toBe("self_change_result");
      expect(resolveOriginProfile(db, event, cycle)).toMatchObject({ profile: "B", triggerKind: "self_change_result", source: "event_kind" });
    } finally { db.close(); }
  });
  it("recovers private result origin without granting Owner profile", () => {
    const db = openTestSidecar();
    try {
      const original = appendInboxEvent(db, { id: "self-origin", conversationId: "private-self", kind: "self_change_result", payload: { changesetId: "cs_fixture" }, createdAtMs: 1 });
      const originalCycleId = (original.payload as { cycleId: string }).cycleId;
      const cycle = getCycle(db, originalCycleId)!;
      const recovery = { ...original, id: "self-recovery", kind: "recovery", payload: { cycleId: originalCycleId } };
      expect(resolveOriginProfile(db, recovery, { ...cycle, triggerKind: "recovery" })).toMatchObject({ profile: "B", triggerKind: "self_change_result", source: "payload_cycle" });
    } finally { db.close(); }
  });
});

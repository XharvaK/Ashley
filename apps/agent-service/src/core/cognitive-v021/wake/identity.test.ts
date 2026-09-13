import { describe, expect, it } from "vitest";
import { occurrenceIdFor, wakeIdFor } from "./identity.js";

describe("wake identities", () => {
  it("converges duplicate producers on deterministic occurrence identity", () => {
    const first = occurrenceIdFor({ sourceKind: "future_trigger", triggerRef: "trigger-1", conversationId: "conversation-1" });
    const second = occurrenceIdFor({ sourceKind: "future_trigger", triggerRef: "trigger-1", conversationId: "conversation-1" });
    expect(first).toBe(second);
    expect(wakeIdFor(first)).toBe(wakeIdFor(first));
    expect(first).toMatch(/^wake-occurrence:/);
  });
});

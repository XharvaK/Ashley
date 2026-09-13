import { describe, expect, it } from "vitest";
import { selectFairEligibleHead, selectFairWork } from "./scheduler.js";

describe("durable retry fairness", () => {
  it("skips retry-wait and poisoned lanes and chooses the least recently served eligible conversation", () => {
    expect(selectFairWork([
      { eventId: "poison", lane: "interactive", conversationId: "a", state: "quarantined", nextEligibleAtMs: 0, createdAtMs: 1, lastServedAtMs: 0 },
      { eventId: "waiting", lane: "interactive", conversationId: "b", state: "retry_wait", nextEligibleAtMs: 100, createdAtMs: 1, lastServedAtMs: 0 },
      { eventId: "eligible-new", lane: "interactive", conversationId: "b", state: "pending", nextEligibleAtMs: null, createdAtMs: 2, lastServedAtMs: 20 },
      { eventId: "eligible-old", lane: "interactive", conversationId: "c", state: "pending", nextEligibleAtMs: null, createdAtMs: 1, lastServedAtMs: 10 },
    ], 50)).toMatchObject({ eventId: "eligible-old", conversationId: "c" });
  });

  it("serves the owner-interactive lane before a less recently served proactive lane", () => {
    expect(selectFairEligibleHead([
      { eventId: "proactive", lane: "proactive", conversationId: "p", state: "pending", nextEligibleAtMs: null, createdAtMs: 1, lastServedAtMs: 0 },
      { eventId: "interactive", lane: "interactive", conversationId: "i", state: "pending", nextEligibleAtMs: null, createdAtMs: 2, lastServedAtMs: 100 },
    ], 10)?.eventId).toBe("interactive");
    expect(selectFairWork([], 10)).toBeNull();
  });
});

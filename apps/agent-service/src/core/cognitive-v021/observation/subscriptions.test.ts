import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ObservationSubscription } from "../types.js";
import { openTestSidecar } from "../test-support.js";
import {
  createObservationSubscription,
  listObservationSubscriptions,
  matchSubscriptionItem,
  collectSubscriptionObservations,
} from "./subscriptions.js";

const subscription: ObservationSubscription = {
  subscriptionId: "subscription-hy3",
  conversationId: "thread-subscription",
  concernId: "concern-hy3",
  source: "curiosity.cur_items",
  scope: "owner-thread",
  topicKeys: ["hy3"],
  match: "substring",
  expiresAtMs: null,
  status: "active",
};

describe("v0.2.1 mechanical observation subscriptions", () => {
  it("turns a matching item into a subscription observation and rejects an unmatched item", () => {
    const observation = matchSubscriptionItem(subscription, "HY3 paper", { cycleId: "cycle-1", generation: 2, nowMs: 10 });
    expect(observation).toMatchObject({
      cycleId: "cycle-1",
      generation: 2,
      modality: "subscription",
      provenance: "subscription:subscription-hy3:curiosity.cur_items",
      derived: true,
      replaySafe: true,
    });
    expect(observation?.payload).toMatchObject({ text: "HY3 paper" });
    expect(matchSubscriptionItem(subscription, "weather", { cycleId: "cycle-1", generation: 2, nowMs: 10 })).toBeNull();
  });

  it("honors equality, expiry, and the bounded item collection", () => {
    const equal: ObservationSubscription = { ...subscription, match: "equality", topicKeys: ["hy3"] };
    expect(matchSubscriptionItem(equal, { topicKey: "hy3", text: "HY3" })).not.toBeNull();
    expect(matchSubscriptionItem(equal, { topicKey: "HY3 paper", text: "HY3 paper" })).toBeNull();
    expect(matchSubscriptionItem({ ...subscription, expiresAtMs: 10 }, "HY3 paper", { nowMs: 10 })).toBeNull();

    const db = openTestSidecar();
    try {
      createObservationSubscription(db, subscription);
      const observations = collectSubscriptionObservations(db, "thread-subscription", [
        { text: "HY3 paper" },
        { text: "HY3 second item" },
        { text: "HY3 third item" },
        { text: "HY3 fourth item" },
        { text: "HY3 fifth item" },
      ], { cycleId: "cycle-sub", generation: 1, nowMs: 20, limit: 4 });
      expect(observations).toHaveLength(4);
      expect(listObservationSubscriptions(db, "thread-subscription")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects a seventeenth active subscription and contains no embedding path", () => {
    const db = openTestSidecar();
    try {
      for (let index = 0; index < 16; index += 1) {
        createObservationSubscription(db, { ...subscription, subscriptionId: `subscription-${index}`, topicKeys: [`topic-${index}`] });
      }
      expect(() => createObservationSubscription(db, { ...subscription, subscriptionId: "subscription-17", topicKeys: ["topic-17"] })).toThrow("subscription_capacity_exceeded");
    } finally {
      db.close();
    }
    const source = readFileSync(fileURLToPath(new URL("./subscriptions.ts", import.meta.url)), "utf8").toLowerCase();
    expect(source).not.toContain("embed");
  });
});

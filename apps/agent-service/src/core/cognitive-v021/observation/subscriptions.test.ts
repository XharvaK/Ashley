import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ObservationSubscription } from "../types.js";
import { openTestSidecar } from "../test-support.js";
import {
  createObservationSubscription,
  listObservationSubscriptions,
  matchSubscriptionItem,
  collectSubscriptionObservations,
  claimObservationSubscriptionPoll,
  MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
  pollObservationSubscriptions,
} from "./subscriptions.js";
import { persistOrVerifyObservations } from "./persistence.js";

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

  it("adopts an external watch, polls without Thought per poll, and fires only relevant attributed evidence", async () => {
    const db = openTestSidecar();
    const external = {
      ...subscription,
      subscriptionId: "watch-hy3",
      source: "owner_adopted_watch",
      externalSource: { kind: "rss" as const, urlPattern: "https://public.test/feed" },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 10_000,
      requesterId: "owner-42",
    };
    const fetcher = vi.fn(async () => new Response(
      "<rss><channel><item><title>HY3 release</title><link>https://public.test/article</link><description>new evidence</description></item></channel></rss>",
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    ));
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    try {
      createObservationSubscription(db, external);
      const first = await pollObservationSubscriptions(db, { nowMs: 1_000, fetcher, resolve });
      expect(first.outcomes).toEqual([expect.objectContaining({ subscriptionId: "watch-hy3", kind: "matched" })]);
      expect(first.items).toHaveLength(1);
      const observations = collectSubscriptionObservations(db, "thread-subscription", first.items, { nowMs: 1_000 });
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({ provenance: "subscription:watch-hy3:owner_adopted_watch:requester:owner-42" });
      expect(observations[0]?.payload).toMatchObject({ requesterId: "owner-42", ownerRequested: true });

      const second = await pollObservationSubscriptions(db, { nowMs: 1_001, fetcher, resolve });
      expect(second.outcomes).toEqual([expect.objectContaining({ subscriptionId: "watch-hy3", kind: "not_due" })]);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(observations[0]?.payload).not.toHaveProperty("interest");
    } finally {
      db.close();
    }
  });

  it("claims an external watch once and releases only after durable observation ingest", async () => {
    const db = openTestSidecar();
    const external = {
      ...subscription,
      subscriptionId: "watch-claim",
      externalSource: { kind: "url" as const, urlPattern: "https://public.test/claim" },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 1_000_000,
    };
    const fetcher = vi.fn(async () => new Response("<html><body>HY3 claimed</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    try {
      createObservationSubscription(db, external);
      const polled = await pollObservationSubscriptions(db, { nowMs: 1_000, fetcher, resolve });
      expect(polled.items).toHaveLength(1);
      const claimed = claimObservationSubscriptionPoll(db, "watch-claim", 1_000);
      expect(claimed).toBeNull();
      expect(db.prepare("SELECT poll_claim_token, poll_generation, ingested_frontier_at_ms FROM observation_subscriptions WHERE subscription_id = ?").get("watch-claim"))
        .toMatchObject({ poll_generation: 1, ingested_frontier_at_ms: null });
      const observations = collectSubscriptionObservations(db, "thread-subscription", polled.items, { cycleId: "cycle:claim", generation: 1, nowMs: 1_000 });
      persistOrVerifyObservations(db, observations, 1_000);
      expect(db.prepare("SELECT poll_claim_token, poll_claim_expires_at_ms, poll_generation, ingested_frontier_at_ms FROM observation_subscriptions WHERE subscription_id = ?").get("watch-claim"))
        .toMatchObject({ poll_claim_token: null, poll_claim_expires_at_ms: null, poll_generation: 1, ingested_frontier_at_ms: 1_000 });
    } finally {
      db.close();
    }
  });

  it("allows a lease-expired worker to retry but rejects stale frontier advancement", () => {
    const db = openTestSidecar();
    const external = {
      ...subscription,
      subscriptionId: "watch-stale-claim",
      externalSource: { kind: "url" as const, urlPattern: "https://public.test/stale" },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 10_000,
    };
    try {
      createObservationSubscription(db, external);
      const first = claimObservationSubscriptionPoll(db, external.subscriptionId, 1_000)!;
      const second = claimObservationSubscriptionPoll(db, external.subscriptionId, first.expiresAtMs + 1)!;
      expect(second.generation).toBe(first.generation + 1);
      const stale = {
        observationId: "observation:stale-claim",
        cycleId: "cycle:stale-claim",
        generation: 1,
        derived: true,
        replaySafe: true,
        modality: "subscription" as const,
        payload: { text: "stale" },
        provenance: "subscription:watch-stale-claim",
        dataClassification: "ordinary" as const,
        secretOmitted: false,
        pollClaim: first,
      };
      persistOrVerifyObservations(db, [stale], 2_000);
      expect(db.prepare("SELECT COUNT(*) AS count FROM observations WHERE observation_id = ?").get(stale.observationId))
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT poll_generation, ingested_frontier_at_ms, poll_claim_token FROM observation_subscriptions WHERE subscription_id = ?").get(external.subscriptionId))
        .toMatchObject({ poll_generation: second.generation, ingested_frontier_at_ms: null, poll_claim_token: second.claimToken });
    } finally {
      db.close();
    }
  });

  it("distinguishes complete no-match from failed observation and rejects a descriptor violation", async () => {
    const db = openTestSidecar();
    const makeExternal = (subscriptionId: string, urlPattern: string) => ({
      ...subscription,
      subscriptionId,
      externalSource: { kind: "rss" as const, urlPattern },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 10_000,
    });
    const noMatch = makeExternal("watch-no-match", "https://public.test/no-match");
    const failed = makeExternal("watch-failed", "https://public.test/failure");
    const violated = makeExternal("watch-violated", "https://public.test/redirect");
    let redirected = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/failure")) throw new Error("upstream_unavailable");
      if (url.endsWith("/redirect") && !redirected) {
        redirected = true;
        return new Response(null, { status: 302, headers: { location: "https://other.test/feed" } });
      }
      return new Response("<rss><channel></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    });
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    try {
      createObservationSubscription(db, noMatch);
      createObservationSubscription(db, failed);
      createObservationSubscription(db, violated);
      const result = await pollObservationSubscriptions(db, { nowMs: 1_000, fetcher, resolve });
      expect(result.outcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ subscriptionId: "watch-no-match", kind: "complete_no_match" }),
        expect.objectContaining({ subscriptionId: "watch-failed", kind: "fetch_failure" }),
        expect.objectContaining({ subscriptionId: "watch-violated", kind: "rejected", reason: "source_descriptor_violation" }),
      ]));
      const failedItem = result.items.find((item) => item.pollSubscriptionId === "watch-failed");
      expect(failedItem?.pollOutcome).toBe("fetch_failure");
      expect(collectSubscriptionObservations(db, "thread-subscription", result.items, { nowMs: 1_000 })[0]?.payload)
        .toMatchObject({ kind: "operational_watch_outcome", outcome: "fetch_failure" });
      expect(result.items.some((item) => item.pollSubscriptionId === "watch-no-match")).toBe(false);
      expect(result.items.some((item) => item.pollSubscriptionId === "watch-violated")).toBe(false);
      expect(listObservationSubscriptions(db, "thread-subscription").find((item) => item.subscriptionId === "watch-no-match"))
        .toMatchObject({ lastPollOutcome: "complete_no_match" });
    } finally {
      db.close();
    }
  });

  it("emits one operational expiry opportunity without cancelling or semantically retiring the watch", async () => {
    const db = openTestSidecar();
    const external = {
      ...subscription,
      subscriptionId: "watch-expiry",
      externalSource: { kind: "url_pattern" as const, urlPattern: "https://public.test/topic" },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 100,
      requesterId: "owner-42",
    };
    const fetcher = vi.fn(async () => new Response("should not fetch", { status: 200 }));
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    try {
      createObservationSubscription(db, external);
      const first = await pollObservationSubscriptions(db, { nowMs: 100, fetcher, resolve });
      expect(first.outcomes).toEqual([expect.objectContaining({ kind: "expired", reason: "admitted_watch_expired" })]);
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({ pollOutcome: "operational_expiry", pollSubscriptionId: "watch-expiry" });
      const expiry = collectSubscriptionObservations(db, "thread-subscription", first.items, { nowMs: 100 })[0];
      expect(expiry?.payload).toMatchObject({ kind: "operational_watch_outcome", outcome: "operational_expiry", ownerRequested: true });
      expect(db.prepare("SELECT cancelled FROM observation_subscriptions WHERE subscription_id = 'watch-expiry'").get())
        .toEqual({ cancelled: 0 });

      const second = await pollObservationSubscriptions(db, { nowMs: 101, fetcher, resolve });
      expect(second.outcomes).toEqual([expect.objectContaining({ kind: "expired" })]);
      expect(second.items).toHaveLength(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("refuses same-id authority expansion unless renewed authority is explicit", () => {
    const db = openTestSidecar();
    const external = {
      ...subscription,
      subscriptionId: "watch-renewal",
      externalSource: { kind: "json" as const, urlPattern: "https://public.test/data" },
      pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      expiresAtMs: 10_000,
    };
    try {
      createObservationSubscription(db, external);
      expect(() => createObservationSubscription(db, { ...external, expiresAtMs: 20_000 })).toThrow("subscription_renewal_authority_required");
      expect(listObservationSubscriptions(db, "thread-subscription").find((item) => item.subscriptionId === "watch-renewal"))
        .toMatchObject({ expiresAtMs: 10_000 });
      expect(createObservationSubscription(db, { ...external, expiresAtMs: 20_000 }, 16, { authority: "thought_adoption" }))
        .toMatchObject({ expiresAtMs: 20_000 });
    } finally {
      db.close();
    }
  });
});

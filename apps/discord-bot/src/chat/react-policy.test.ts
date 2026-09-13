import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReactPolicy, reactDelayMs } from "./react-policy.js";

const ctx = (over: Partial<Parameters<ReactPolicy["decide"]>[0]> = {}) => ({
  channelId: "c1",
  emoji: "😂",
  docText: "hey",
  herText: "yeah",
  rand: () => 0,
  ...over,
});

describe("ReactPolicy", () => {
  it("allows the first reaction", () => {
    assert.equal(new ReactPolicy().decide(ctx()), "😂");
  });

  it("skips an emoji Doc just used", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx({ docText: "that's fine 😂" })), null);
  });

  it("skips an emoji already in her own text", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx({ herText: "sure 😂" })), null);
  });

  it("ignores variation selectors and skin tones when mirroring", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx({ emoji: "👍🏽", docText: "nice 👍" })), null);
  });

  it("holds the turn budget after a reaction", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx()), "😂");
    // MIN_TURNS_BETWEEN = 2: next turn is still blocked.
    assert.equal(policy.decide(ctx({ emoji: "🔥" })), null);
    assert.equal(policy.decide(ctx({ emoji: "🔥" })), "🔥");
  });

  it("counts turns with no candidate emoji toward the budget", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx()), "😂");
    policy.decide(ctx({ emoji: null }));
    assert.equal(policy.decide(ctx({ emoji: "🔥" })), "🔥");
  });

  it("never repeats the same emoji back to back", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx()), "😂");
    policy.decide(ctx({ emoji: null }));
    assert.equal(policy.decide(ctx()), null);
  });

  it("tracks channels independently", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx()), "😂");
    assert.equal(policy.decide(ctx({ channelId: "c2" })), "😂");
  });
});

describe("reactDelayMs", () => {
  it("stays between 0.5 and 1.5 seconds", () => {
    assert.equal(reactDelayMs(() => 0), 500);
    assert.equal(reactDelayMs(() => 1), 1500);
  });
});

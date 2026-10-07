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
  it("allows a reaction that mirrors neither side", () => {
    assert.equal(new ReactPolicy().decide(ctx()), "😂");
  });

  it("skips an emoji Alex just used", () => {
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

  it("does not count turns between reactions", () => {
    const policy = new ReactPolicy();
    assert.equal(policy.decide(ctx()), "😂");
    assert.equal(policy.decide(ctx({ emoji: "🔥" })), "🔥");
    assert.equal(policy.decide(ctx({ emoji: null })), null);
    assert.equal(policy.decide(ctx()), "😂");
  });
});

describe("reactDelayMs", () => {
  it("stays between 0.5 and 1.5 seconds", () => {
    assert.equal(reactDelayMs(() => 0), 500);
    assert.equal(reactDelayMs(() => 1), 1500);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSlidingWindowLimiter } from "./guest-throttle.js";
import { createBotExchangeGuard } from "./bot-loop-guard.js";

describe("createSlidingWindowLimiter", () => {
  it("admits up to the max per key inside the window, then refuses", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1_000, max: 2 });
    assert.equal(limiter.admit("guest-a", 0), true);
    assert.equal(limiter.admit("guest-a", 10), true);
    assert.equal(limiter.admit("guest-a", 20), false);
  });

  it("keeps each key on its own budget", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1_000, max: 1 });
    assert.equal(limiter.admit("guest-a", 0), true);
    assert.equal(limiter.admit("guest-b", 0), true);
    assert.equal(limiter.admit("guest-a", 1), false);
  });

  it("frees the budget once the window has passed", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1_000, max: 1 });
    assert.equal(limiter.admit("guest-a", 0), true);
    assert.equal(limiter.admit("guest-a", 999), false);
    assert.equal(limiter.admit("guest-a", 1_000), true);
  });
});

describe("createBotExchangeGuard", () => {
  it("admits bot messages up to the limit, then stops until a person speaks", () => {
    const guard = createBotExchangeGuard({ limit: 2 });
    assert.equal(guard.admit("room-1", true), true);
    assert.equal(guard.admit("room-1", true), true);
    assert.equal(guard.admit("room-1", true), false);
    assert.equal(guard.admit("room-1", false), true);
    assert.equal(guard.admit("room-1", true), true);
  });

  it("counts each channel separately", () => {
    const guard = createBotExchangeGuard({ limit: 1 });
    assert.equal(guard.admit("room-1", true), true);
    assert.equal(guard.admit("room-2", true), true);
    assert.equal(guard.admit("room-1", true), false);
  });
});

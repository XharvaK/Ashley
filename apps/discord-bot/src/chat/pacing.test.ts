import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACE_BUDGET_MS,
  TempoTracker,
  bubbleDelayMs,
  sleepAbortable,
} from "./pacing.js";

describe("bubbleDelayMs", () => {
  const mid = () => 0.5;

  it("stays in the 3–10s band for normal bubbles", () => {
    const short = bubbleDelayMs({
      tempoGapMs: 4000,
      chars: 40,
      remainingBudgetMs: PACE_BUDGET_MS,
      rand: mid,
    });
    const long = bubbleDelayMs({
      tempoGapMs: 4000,
      chars: 400,
      remainingBudgetMs: PACE_BUDGET_MS,
      rand: mid,
    });
    assert.ok(short >= 3000 && short <= 10000, `short=${short}`);
    assert.ok(long >= 3000 && long <= 10000, `long=${long}`);
    assert.ok(long >= short, `long ${long} should be >= short ${short}`);
  });

  it("never exceeds the remaining budget", () => {
    const ms = bubbleDelayMs({
      tempoGapMs: null,
      chars: 2000,
      remainingBudgetMs: 300,
      rand: mid,
    });
    assert.equal(ms, 300);
  });

  it("is zero once the budget is spent", () => {
    assert.equal(
      bubbleDelayMs({ tempoGapMs: null, chars: 10, remainingBudgetMs: 0 }),
      0,
    );
  });

  it("keeps a whole turn inside the cap", () => {
    let budget = PACE_BUDGET_MS;
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const ms = bubbleDelayMs({
        tempoGapMs: 5 * 60 * 1000,
        chars: 300,
        remainingBudgetMs: budget,
        rand: () => 1,
      });
      budget -= ms;
      total += ms;
    }
    assert.ok(total <= PACE_BUDGET_MS, `total ${total}`);
  });
});

describe("sleepAbortable", () => {
  it("returns early on abort", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    await sleepAbortable(5000, controller.signal);
    assert.ok(Date.now() - started < 500);
  });

  it("does not wait at all when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await sleepAbortable(5000, controller.signal);
    assert.ok(Date.now() - started < 100);
  });
});

describe("TempoTracker", () => {
  it("has no gap for a first message", () => {
    const tracker = new TempoTracker();
    assert.equal(tracker.mark("c1", 1000), null);
  });

  it("reports the gap between his messages", () => {
    const tracker = new TempoTracker();
    tracker.mark("c1", 1000);
    assert.equal(tracker.mark("c1", 6000), 5000);
  });

  it("keeps channels separate", () => {
    const tracker = new TempoTracker();
    tracker.mark("c1", 1000);
    assert.equal(tracker.mark("c2", 2000), null);
  });
});

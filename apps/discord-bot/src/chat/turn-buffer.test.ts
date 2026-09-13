import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TurnBuffer } from "./turn-buffer.js";

describe("TurnBuffer", () => {
  it("asks for a drain only for the first fragment", () => {
    const buffer = new TurnBuffer<string, string>(() => {}, 20, 100);
    assert.equal(buffer.push("c1", "hey", "m1"), true);
    assert.equal(buffer.push("c1", "you around", "m2"), false);
  });

  it("keeps every fragment and the latest target", () => {
    let channel = "";
    const buffer = new TurnBuffer<string, string>((id) => {
      channel = id;
    }, 50, 200);
    buffer.push("c1", "hey", "m1");
    buffer.push("c1", "you around", "m2");
    buffer.flushForTest("c1");
    assert.equal(channel, "c1");
    const taken = buffer.take("c1");
    assert.deepEqual(taken?.fragments, ["hey", "you around"]);
    assert.equal(taken?.target, "m2");
    assert.equal(typeof taken?.finalFragmentReceivedAt, "number");
  });

  it("empties on take so the next fragment queues again", () => {
    const buffer = new TurnBuffer<string, string>(() => {}, 50, 200);
    buffer.push("c1", "hey", "m1");
    buffer.take("c1");
    assert.equal(buffer.take("c1"), null);
    assert.equal(buffer.push("c1", "again", "m3"), true);
  });

  it("keeps channels apart", () => {
    const buffer = new TurnBuffer<string, string>(() => {}, 50, 200);
    buffer.push("c1", "hey", "m1");
    assert.equal(buffer.push("c2", "yo", "m2"), true);
    assert.deepEqual(buffer.take("c1")?.fragments, ["hey"]);
    assert.deepEqual(buffer.take("c2")?.fragments, ["yo"]);
  });

  it("fires onReady after the quiet window", async () => {
    const fired = await new Promise<string>((resolve) => {
      const buffer = new TurnBuffer<string, string>(resolve, 30, 200);
      buffer.push("c1", "hey", "m1");
    });
    assert.equal(fired, "c1");
  });

  it("resets quiet window when another fragment arrives", async () => {
    let count = 0;
    const buffer = new TurnBuffer<string, string>(() => {
      count += 1;
    }, 40, 500);
    buffer.push("c1", "hey", "m1");
    await new Promise((r) => setTimeout(r, 20));
    buffer.push("c1", "again", "m2");
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(count, 0);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(count, 1);
    assert.deepEqual(buffer.take("c1")?.fragments, ["hey", "again"]);
  });
});

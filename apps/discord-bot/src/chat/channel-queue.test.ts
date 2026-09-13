import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelQueue } from "./channel-queue.js";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ChannelQueue", () => {
  it("runs jobs for one channel serially", async () => {
    const queue = new ChannelQueue();
    const order: string[] = [];
    const a = queue.enqueue("c1", async () => {
      await tick(30);
      order.push("a");
    });
    const b = queue.enqueue("c1", async () => {
      order.push("b");
    });
    await Promise.all([a, b]);
    assert.deepEqual(order, ["a", "b"]);
  });

  it("runs different channels in parallel", async () => {
    const queue = new ChannelQueue();
    const order: string[] = [];
    const slow = queue.enqueue("c1", async () => {
      await tick(40);
      order.push("slow");
    });
    const fast = queue.enqueue("c2", async () => {
      order.push("fast");
    });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ["fast", "slow"]);
  });

  it("aborts the running job's signal for that channel only", async () => {
    const queue = new ChannelQueue();
    let aborted = false;
    let otherAborted = false;
    const job = queue.enqueue("c1", async ({ signal }) => {
      await tick(30);
      aborted = signal.aborted;
    });
    const other = queue.enqueue("c2", async ({ signal }) => {
      await tick(30);
      otherAborted = signal.aborted;
    });
    await tick(5);
    queue.abort("c1");
    await Promise.all([job, other]);
    assert.equal(aborted, true);
    assert.equal(otherAborted, false);
  });

  it("keeps the queue alive after a job throws", async () => {
    const queue = new ChannelQueue();
    const order: string[] = [];
    const bad = queue.enqueue("c1", async () => {
      throw new Error("boom");
    });
    const good = queue.enqueue("c1", async () => {
      order.push("ran");
    });
    await Promise.all([bad, good]);
    assert.deepEqual(order, ["ran"]);
  });

  it("drains in-flight work on shutdown", async () => {
    const queue = new ChannelQueue();
    let finished = false;
    queue.enqueue("c1", async () => {
      await tick(20);
      finished = true;
    });
    await queue.drain(1000);
    assert.equal(finished, true);
  });

  it("gives up draining after the timeout", async () => {
    const queue = new ChannelQueue();
    queue.enqueue("c1", async () => {
      await tick(2000);
    });
    const started = Date.now();
    await queue.drain(50);
    assert.ok(Date.now() - started < 500);
  });
});

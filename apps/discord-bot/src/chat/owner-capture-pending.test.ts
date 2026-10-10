import test from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerCaptureQueue,
  type OwnerCaptureStore,
  type PendingOwnerCapture,
} from "./owner-capture-pending.js";

type Item = PendingOwnerCapture & { text: string };

function memoryStore(initial: Item[] = []): OwnerCaptureStore<Item> & { saved: Item[][] } {
  const saved: Item[][] = [];
  return {
    saved,
    load: () => initial.map((item) => ({ ...item })),
    save: (items) => {
      saved.push(items.map((item) => ({ ...item })));
    },
  };
}

function item(id: string): Item {
  return { discordMessageId: id, text: `text ${id}` };
}

function refusal(status: number): Error {
  return Object.assign(new Error("refused"), { status });
}

function silentLog() {
  return { warn: () => undefined, error: () => undefined };
}

test("a capture that succeeds at once is reported as captured and never waits", async () => {
  const captured: string[] = [];
  const queue = createOwnerCaptureQueue<Item>({
    capture: async (value) => { captured.push(value.discordMessageId); },
    store: memoryStore(),
    schedule: () => assert.fail("no retry should be scheduled"),
    log: silentLog(),
  });

  assert.equal(await queue.submit(item("1")), "captured");
  assert.deepEqual(captured, ["1"]);
  assert.equal(queue.pending(), 0);
});

test("a capture that fails is kept durably, retried with backoff, and replayed in order (A6-1)", async () => {
  const store = memoryStore();
  const scheduled: number[] = [];
  let agentUp = false;
  const captured: string[] = [];
  const drained: number[] = [];
  const queue = createOwnerCaptureQueue<Item>({
    capture: async (value) => {
      if (!agentUp) throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
      captured.push(value.discordMessageId);
    },
    store,
    schedule: (_run, delayMs) => { scheduled.push(delayMs); },
    log: silentLog(),
  });
  queue.onDrained(() => { drained.push(captured.length); });

  assert.equal(await queue.submit(item("1")), "not_captured");
  assert.equal(await queue.submit(item("2")), "not_captured");
  assert.equal(queue.pending(), 2);
  assert.ok(scheduled.length >= 1 && scheduled[0]! >= 1_000);
  assert.equal(store.saved.at(-1)?.map((entry) => entry.discordMessageId).join(","), "1,2");

  agentUp = true;
  await queue.flush();
  assert.deepEqual(captured, ["1", "2"]);
  assert.equal(queue.pending(), 0);
  assert.deepEqual(drained, [2]);
});

test("a repeated message id is kept once (A6-1)", async () => {
  const queue = createOwnerCaptureQueue<Item>({
    capture: async () => { throw new Error("down"); },
    store: memoryStore(),
    schedule: () => undefined,
    log: silentLog(),
  });

  await queue.submit(item("7"));
  await queue.submit(item("7"));
  assert.equal(queue.pending(), 1);
});

test("a waiting capture holds back a newer one, so the order never flips (A6-1)", async () => {
  let agentUp = false;
  const order: string[] = [];
  const queue = createOwnerCaptureQueue<Item>({
    capture: async (value) => {
      if (!agentUp) throw new Error("down");
      order.push(value.discordMessageId);
    },
    store: memoryStore(),
    schedule: () => undefined,
    log: silentLog(),
  });

  await queue.submit(item("1"));
  agentUp = true;
  const newer = await queue.submit(item("2"));

  assert.equal(newer, "not_captured");
  await queue.flush();
  assert.deepEqual(order, ["1", "2"]);
});

test("a permanent refusal drops only that capture and the queue carries on (A6-7)", async () => {
  const captured: string[] = [];
  const queue = createOwnerCaptureQueue<Item>({
    capture: async (value) => {
      if (value.discordMessageId === "bad") throw refusal(400);
      captured.push(value.discordMessageId);
    },
    store: memoryStore([item("bad"), item("good")]),
    schedule: () => undefined,
    log: silentLog(),
  });

  await queue.flush();
  assert.deepEqual(captured, ["good"]);
  assert.equal(queue.pending(), 0);
});

test("pending captures survive a restart and are replayed from the store", async () => {
  const captured: string[] = [];
  const queue = createOwnerCaptureQueue<Item>({
    capture: async (value) => { captured.push(value.discordMessageId); },
    store: memoryStore([item("9"), item("10")]),
    schedule: () => undefined,
    log: silentLog(),
  });

  await queue.flush();
  assert.deepEqual(captured, ["9", "10"]);
});

test("the backlog is bounded and the oldest waiting capture is left to history reconciliation", async () => {
  const queue = createOwnerCaptureQueue<Item>({
    capture: async () => { throw new Error("down"); },
    store: memoryStore(),
    limit: 2,
    schedule: () => undefined,
    log: silentLog(),
  });

  await queue.submit(item("1"));
  await queue.submit(item("2"));
  await queue.submit(item("3"));
  assert.equal(queue.pending(), 2);
});

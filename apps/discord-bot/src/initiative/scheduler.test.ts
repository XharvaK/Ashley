import assert from "node:assert/strict";
import { test } from "node:test";
import { runCognitiveIdleSchedulerCycle } from "./scheduler.js";

test("the current idle scheduler always dispatches through V0.2.1", async () => {
  let calls = 0;
  const result = await runCognitiveIdleSchedulerCycle(async () => {
    calls += 1;
    return { reason: "no_opportunity" } as never;
  }, async () => true);

  assert.equal(calls, 1);
  assert.equal(result.outcome, "tick");
  assert.deepEqual(result.result, { reason: "no_opportunity" });
});

test("the current idle scheduler reports a failed agent tick without fallback", async () => {
  const result = await runCognitiveIdleSchedulerCycle(async () => {
    throw new Error("agent_unavailable");
  }, async () => true);

  assert.deepEqual(result, { outcome: "error" });
});

test("the idle scheduler skips the tick while the agent is not ready", async () => {
  let calls = 0;
  const result = await runCognitiveIdleSchedulerCycle(async () => {
    calls += 1;
    return { reason: "must_not_run" } as never;
  }, async () => false);

  assert.deepEqual(result, { outcome: "not_ready" });
  assert.equal(calls, 0);
});

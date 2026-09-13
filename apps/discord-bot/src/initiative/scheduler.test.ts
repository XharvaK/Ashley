import assert from "node:assert/strict";
import { test } from "node:test";
import { runCognitiveIdleSchedulerCycle } from "./scheduler.js";

test("the current idle scheduler always dispatches through V0.2.1", async () => {
  let calls = 0;
  const result = await runCognitiveIdleSchedulerCycle(async () => {
    calls += 1;
    return { reason: "no_opportunity" } as never;
  });

  assert.equal(calls, 1);
  assert.equal(result.outcome, "tick");
  assert.deepEqual(result.result, { reason: "no_opportunity" });
});

test("the current idle scheduler reports a failed agent tick without fallback", async () => {
  const result = await runCognitiveIdleSchedulerCycle(async () => {
    throw new Error("agent_unavailable");
  });

  assert.deepEqual(result, { outcome: "error" });
});

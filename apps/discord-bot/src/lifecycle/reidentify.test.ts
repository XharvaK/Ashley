import test from "node:test";
import assert from "node:assert/strict";
import { createReidentifyGate } from "./reidentify.js";

test("the first identify, before the bot is ready, is not a re-identify (A6-2)", () => {
  const gate = createReidentifyGate();
  assert.equal(gate.isReidentify(), false);
});

test("every identify after the bot is ready is a re-identify that needs recovery (A6-2)", () => {
  const gate = createReidentifyGate();
  gate.markReady();
  assert.equal(gate.isReidentify(), true);
  assert.equal(gate.isReidentify(), true);
});

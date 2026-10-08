import test from "node:test";
import assert from "node:assert/strict";
import { isEphemeralCommand } from "./interactionCreate.js";

test("a remembered fact is shown only to the Owner, even in a shared room", () => {
  assert.equal(isEphemeralCommand("remember"), true);
  assert.equal(isEphemeralCommand("diary"), true);
});

test("proactive status is private; pause and resume answer where they were asked", () => {
  assert.equal(isEphemeralCommand("proactive", "status"), true);
  assert.equal(isEphemeralCommand("proactive", "pause"), false);
});

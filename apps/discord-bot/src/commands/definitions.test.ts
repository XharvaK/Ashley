import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommandDefinitions } from "./definitions.js";

describe("command definitions", () => {
  it("exports ten import-safe slash command definitions", () => {
    const commands = buildCommandDefinitions();
    assert.equal(commands.length, 10);
    const names = commands.map((command) => command.name);
    assert.ok(names.includes("commitments"));
    assert.ok(names.includes("continuity"));
    assert.ok(names.includes("status"));
    assert.ok(names.includes("delegation"));
  });
});

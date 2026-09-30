import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommandDefinitions } from "./definitions.js";
import { commandNames } from "../command-surface.js";

describe("command definitions", () => {
  it("exports one import-safe slash command per surface entry", () => {
    const commands = buildCommandDefinitions();
    const names = commands.map((command) => command.name);
    assert.deepEqual([...names].sort(), [...commandNames].sort());
    assert.equal(names.length, 9);
    assert.ok(names.includes("contacts"));
    assert.ok(names.includes("commitments"));
    assert.ok(names.includes("continuity"));
    assert.ok(names.includes("status"));
    assert.ok(names.includes("delegation"));
  });

  it("no longer offers /forget (retired 2026-09-30: she forgets on the Owner's word, after a confirmation)", () => {
    const names = buildCommandDefinitions().map((command) => command.name);
    assert.ok(!names.includes("forget"));
  });

  it("no longer offers /new (retired 2026-09-29: thread resets hid past conversation)", () => {
    const names = buildCommandDefinitions().map((command) => command.name);
    assert.ok(!names.includes("new"));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommandDefinitions } from "./definitions.js";
import { commandNames } from "../command-surface.js";

describe("command definitions", () => {
  it("exports one import-safe slash command per surface entry", () => {
    const commands = buildCommandDefinitions();
    const names = commands.map((command) => command.name);
    assert.deepEqual([...names].sort(), [...commandNames].sort());
    assert.equal(names.length, 13);
    assert.ok(names.includes("diary"));
    assert.ok(names.includes("attention"));
    assert.ok(names.includes("contacts"));
    assert.ok(names.includes("places"));
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

describe("A3b identity choices", () => {
  it("offers the practices view", () => {
    const identity = buildCommandDefinitions().find(command => command.name === "identity")!;
    const action = identity.options!.find(option => option.name === "action") as any;
    assert.ok(action.choices.some((choice: any) => choice.value === "practices"), "practice action exists");
    assert.ok(action.choices.some((choice: any) => choice.value === "seed-dimension"), "seed action exists");
    assert.ok(action.choices.some((choice: any) => choice.value === "revert-dimension"), "revert action exists");
  });
});

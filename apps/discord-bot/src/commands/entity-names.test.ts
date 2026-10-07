import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildCommandDefinitions } from "./definitions.js";

afterEach(() => {
  delete process.env.ASHLEY_ENTITY_NAME;
});

describe("command descriptions", () => {
  it("uses the configured entity name", () => {
    process.env.ASHLEY_ENTITY_NAME = "Nova";
    const contacts = buildCommandDefinitions().find((command) => command.name === "contacts");
    assert.equal(contacts?.description, "Who may talk with Nova (trusted contacts)");
  });
});

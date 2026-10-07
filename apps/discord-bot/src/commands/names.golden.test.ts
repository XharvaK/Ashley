import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCommandDefinitions } from "./definitions.js";

describe("command definition name golden hash", () => {
  it("pins the registered command list", () => {
    delete process.env.ASHLEY_ENTITY_NAME;
    delete process.env.ASHLEY_OWNER_NAME;
    delete process.env.ASHLEY_CHANNELS;
    const actual = createHash("sha256")
      .update(JSON.stringify(buildCommandDefinitions()))
      .digest("hex");
    assert.equal(actual, "1725690b2803035f74b028f22ee79ebd379abef031b8bbc93cb6d1bf67c8a1fb");
  });
});

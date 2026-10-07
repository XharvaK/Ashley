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
    assert.equal(actual, "1d36e916efcc53d69c364f3ae94de68a12c3ffe17a5647e4bf08e0418425ab30");
  });
});

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
    assert.equal(actual, "87b6f0a6f2f9b6246c0963d467546854897ac9130e0d63c0eebbfaee05459e5f");
  });
});

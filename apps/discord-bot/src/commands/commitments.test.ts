import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execute } from "./commitments.js";

describe("commitments command", () => {
  it("exports an execute handler", () => {
    assert.equal(typeof execute, "function");
  });
});

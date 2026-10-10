import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorSummary } from "./error-summary.js";

describe("errorSummary", () => {
  it("names the class when there is no code", () => {
    assert.equal(errorSummary(new TypeError("boom")), "TypeError");
  });

  it("adds the own code and the cause code without the message text", () => {
    const cause = Object.assign(new Error("connect refused at a private address"), { code: "ECONNREFUSED" });
    const error = Object.assign(new TypeError("fetch failed"), { cause });
    assert.equal(errorSummary(error), "TypeError code=ECONNREFUSED");
    assert.equal(errorSummary(Object.assign(new Error("x"), { code: 404 })), "Error code=404");
  });

  it("labels a non-error value", () => {
    assert.equal(errorSummary("text"), "non-error");
  });
});

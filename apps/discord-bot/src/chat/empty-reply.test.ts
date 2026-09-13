import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyReplyAction } from "./empty-reply.js";

describe("emptyReplyAction", () => {
  it("retries once then fumbles", () => {
    assert.equal(emptyReplyAction(0), "retry");
    assert.equal(emptyReplyAction(1), "fumble");
    assert.equal(emptyReplyAction(2), "fumble");
  });
});

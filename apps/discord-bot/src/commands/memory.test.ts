import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execute, renderMemorySummary } from "./memory.js";

describe("memory command", () => {
  it("exports an execute handler", () => {
    assert.equal(typeof execute, "function");
  });

  it("renders empty stored memory as a mechanical Host listing", () => {
    const rendered = renderMemorySummary({ narrative: null, facts: [] });
    assert.equal(rendered, "Stored memory summary: no pinned memories.");
    assert.doesNotMatch(rendered, /tell me/i);
    assert.doesNotMatch(rendered, /I've got/i);
    assert.doesNotMatch(rendered, /Nothing pinned yet/);
  });

  it("renders pinned notes under the mechanical Host listing", () => {
    const rendered = renderMemorySummary({
      narrative: null,
      facts: [{ category: "note", value: "keep this" }],
    });
    assert.match(rendered, /^Stored memory summary:/);
    assert.match(rendered, /Standing notes:/);
    assert.doesNotMatch(rendered, /tell me/i);
  });
});

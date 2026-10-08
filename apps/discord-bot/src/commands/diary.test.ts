import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execute, renderSimsDiary } from "./diary.js";

describe("diary command", () => {
  it("exports an execute handler", () => {
    assert.equal(typeof execute, "function");
  });

  it("renders one Sims diary entry", () => {
    const rendered = renderSimsDiary([{
      world: "willow",
      at: "2026-10-06T23:00:00.000Z",
      text: "I played until my eyes closed.",
    }]);
    assert.equal(rendered, "Her Sims diary:\n\n2026-10-06 (willow):\nI played until my eyes closed.");
  });

  it("cuts a long diary to fit one Discord message, visibly", () => {
    const long = "x".repeat(900);
    const rendered = renderSimsDiary([1, 2, 3].map((day) => ({
      world: "willow",
      at: `2026-10-0${day}T23:00:00.000Z`,
      text: long,
    })));
    assert.ok(rendered.length <= 2_000);
    assert.ok(rendered.endsWith("… (cut to fit)"));
  });

  it("says when there are no entries", () => {
    assert.equal(renderSimsDiary([]), "No Sims diary entries yet.");
  });
});

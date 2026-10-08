import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitLines } from "./fit-lines.js";

describe("fitLines", () => {
  it("keeps every line when they fit", () => {
    assert.equal(fitLines(["a", "bb", "ccc"], 100), "a\nbb\nccc");
  });

  it("stops at the last whole line that fits", () => {
    assert.equal(fitLines(["aaaa", "bbbb", "cccc"], 10), "aaaa\nbbbb");
  });

  it("cuts a single over-long line hard instead of returning nothing", () => {
    assert.equal(fitLines(["x".repeat(30)], 10), "x".repeat(10));
  });

  it("returns an empty string for no lines", () => {
    assert.equal(fitLines([]), "");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitLines, pageLines } from "./fit-lines.js";

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

describe("pageLines", () => {
  it("keeps a short list on one page", () => {
    assert.deepEqual(pageLines(["a", "bb"], 100), ["a\nbb"]);
  });

  it("starts a new page at a whole line and keeps every line (A6-12)", () => {
    assert.deepEqual(pageLines(["aaaa", "bbbb", "cccc"], 10), ["aaaa\nbbbb", "cccc"]);
  });

  it("never sends a page over the limit and loses no line", () => {
    const lines = Array.from({ length: 80 }, (_, index) => `<@${String(index).padStart(18, "0")}> (DMs only)`);
    const pages = pageLines(lines, 1900);
    assert.ok(pages.length > 1);
    for (const page of pages) assert.ok(page.length <= 1900);
    assert.deepEqual(pages.join("\n").split("\n"), lines);
  });

  it("returns no pages for no lines", () => {
    assert.deepEqual(pageLines([]), []);
  });
});

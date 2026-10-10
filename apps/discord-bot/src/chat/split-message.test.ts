import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMediaMarkers } from "./media-markers.js";
import { capRoomBubbles, splitMessage } from "./split-message.js";

describe("splitMessage", () => {
  it("keeps a single short bubble", () => {
    assert.deepEqual(splitMessage("hey"), ["hey"]);
  });

  it("splits on blank lines without page prefixes", () => {
    assert.deepEqual(splitMessage("a\n\nb"), ["a", "b"]);
  });

  it("does not drop overflow bubbles", () => {
    assert.deepEqual(splitMessage("a\n\nb\n\nc\n\nd"), ["a", "b", "c", "d"]);
  });
});

describe("parseMediaMarkers", () => {
  it("strips react and gif markers", () => {
    const r = parseMediaMarkers(
      "hello there\n\nsecond bubble\n[[react:😂]]\n[[gif:rabbit hole]]",
    );
    assert.equal(r.react, "😂");
    assert.equal(r.gifQuery, "rabbit hole");
    assert.equal(r.text, "hello there\n\nsecond bubble");
  });

  it("returns nulls when absent", () => {
    const r = parseMediaMarkers("just text");
    assert.equal(r.react, null);
    assert.equal(r.gifQuery, null);
    assert.equal(r.text, "just text");
  });

  it("parses marker-only raw (bot must not send react-only)", () => {
    const r = parseMediaMarkers("[[gif:shocked face]]\n[[react:😲]]");
    assert.equal(r.text, "");
    assert.equal(r.gifQuery, "shocked face");
    assert.equal(r.react, "😲");
  });
});

describe("capRoomBubbles", () => {
  it("keeps the first three bubbles of a longer room reply", () => {
    assert.deepEqual(capRoomBubbles(["a", "b", "c", "d", "e"]), ["a", "b", "c"]);
  });

  it("leaves a short reply untouched", () => {
    assert.deepEqual(capRoomBubbles(["a"]), ["a"]);
  });
});

describe("splitMessage surrogate pairs (A6-15)", () => {
  it("never cuts an emoji pair across two bubbles", () => {
    const text = "a".repeat(1989) + "\u{1F600}" + "b".repeat(10);
    const bubbles = splitMessage(text);
    assert.equal(bubbles.length, 2);
    for (const bubble of bubbles) {
      assert.doesNotMatch(bubble, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    assert.equal(bubbles.join(""), text);
    assert.ok(bubbles[1]!.startsWith("\u{1F600}"));
  });
});

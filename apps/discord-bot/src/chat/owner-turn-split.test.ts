import test from "node:test";
import assert from "node:assert/strict";
import { OWNER_TURN_TEXT_LIMIT, splitOwnerTurn } from "./owner-turn-split.js";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("a joined turn that fits stays one part with every id (A6-7)", () => {
  assert.deepEqual(
    splitOwnerTurn([{ text: "one", id: "1" }, { text: "two", id: "2" }]),
    [{ text: "one\ntwo", ids: ["1", "2"] }],
  );
});

test("a joined turn over the agent limit is split into parts the agent accepts, each fragment whole (A6-7)", () => {
  const first = "a".repeat(2_500);
  const second = "b".repeat(2_500);
  const parts = splitOwnerTurn([{ text: first, id: "1" }, { text: second, id: "2" }]);

  assert.deepEqual(parts.map((part) => part.ids), [["1"], ["2"]]);
  assert.deepEqual(parts.map((part) => part.text), [first, second]);
  for (const part of parts) assert.ok(part.text.length <= OWNER_TURN_TEXT_LIMIT);
});

test("one fragment longer than the limit is cut, its id goes with the first cut, and no emoji is split (A6-7)", () => {
  const text = "x".repeat(OWNER_TURN_TEXT_LIMIT - 1) + "\u{1F600}" + "y".repeat(50);
  const parts = splitOwnerTurn([{ text, id: "9" }]);

  assert.ok(parts.length >= 2);
  assert.deepEqual(parts[0]!.ids, ["9"]);
  for (const part of parts) {
    assert.ok(part.text.length <= OWNER_TURN_TEXT_LIMIT);
    assert.doesNotMatch(part.text, LONE_SURROGATE);
  }
  assert.equal(parts.map((part) => part.text).join(""), text);
});

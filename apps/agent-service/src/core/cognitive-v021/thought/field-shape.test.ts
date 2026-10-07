import { describe, expect, it } from "vitest";
import { describeFieldShape } from "./field-shape.js";

const SECRET = "SECRETWORD";

describe("describeFieldShape", () => {
  it("names null", () => {
    expect(describeFieldShape(JSON.stringify({ note: null }), "note")).toBe("null");
  });

  it("names a missing field absent", () => {
    expect(describeFieldShape(JSON.stringify({ note: "x" }), "missing")).toBe("absent");
  });

  it("counts object keys without naming them, unless they are contract vocabulary", () => {
    const shape = describeFieldShape(JSON.stringify({ note: { [SECRET]: 1, other: true } }), "note");
    expect(shape).toBe("object(keys 2: +2 unknown)");
    expect(describeFieldShape(JSON.stringify({ domusAct: { option: "a1", forOwner: true, [SECRET]: 1 } }), "domusAct"))
      .toBe("object(keys 3: option,forOwner,+1 unknown)");
  });

  it("reports string length without the characters", () => {
    expect(describeFieldShape(JSON.stringify({ note: SECRET }), "note")).toBe(`string(len ${SECRET.length})`);
  });

  it("lists distinct array element types in first-seen order", () => {
    const shape = describeFieldShape(
      JSON.stringify({ items: [SECRET, 1, null, true, { a: 1 }, ["nested"], "again", 2] }),
      "items",
    );
    expect(shape).toBe("array(len 8; types string,number,null,boolean,object,array)");
  });

  it("counts how many string elements are in the reference set", () => {
    const shape = describeFieldShape(
      JSON.stringify({ sourceRefs: [SECRET, "ref-known"] }),
      "sourceRefs",
      new Set(["ref-known"]),
    );
    expect(shape).toBe("array(len 2; types string; known 1/2)");
  });

  it("walks a nested index path", () => {
    const text = JSON.stringify({
      durableNominations: [{ sourceRefs: [SECRET, "ref-a"] }],
    });
    expect(describeFieldShape(text, "durableNominations[0].sourceRefs", new Set(["ref-a"])))
      .toBe("array(len 2; types string; known 1/2)");
  });

  it("reports text that is not JSON", () => {
    expect(describeFieldShape(`not json ${SECRET}`, "note")).toBe("unparseable");
  });

  it("uses a dash when no field is named", () => {
    expect(describeFieldShape(JSON.stringify({ note: SECRET }), undefined)).toBe("-");
  });

  it("never echoes an input string value", () => {
    const samples: Array<[string, string | undefined, ReadonlySet<string> | undefined]> = [
      [JSON.stringify({ note: null }), "note", undefined],
      [JSON.stringify({ note: "x" }), "missing", undefined],
      [JSON.stringify({ note: { [SECRET]: 1 } }), "note", undefined],
      [JSON.stringify({ note: SECRET }), "note", undefined],
      [JSON.stringify({ items: [SECRET, 1, null, true, {}, []] }), "items", undefined],
      [JSON.stringify({ sourceRefs: [SECRET, "ref-known"] }), "sourceRefs", new Set([SECRET, "ref-known"])],
      [JSON.stringify({ durableNominations: [{ sourceRefs: [SECRET] }] }), "durableNominations[0].sourceRefs", new Set([SECRET])],
      [`{broken ${SECRET}`, "note", undefined],
      [JSON.stringify({ [SECRET]: SECRET }), undefined, new Set([SECRET])],
    ];
    for (const [text, field, refs] of samples) {
      expect(describeFieldShape(text, field, refs)).not.toContain(SECRET);
    }
  });
});

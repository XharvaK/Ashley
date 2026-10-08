import { describe, it, expect } from "vitest";
import {
  inspectRequiredObservation,
  malformedObservationDetail,
} from "../composition-contract.js";
import type { AllocationFailureDiagnostic } from "../receipt.js";

function malformedFailure(value: unknown): AllocationFailureDiagnostic {
  const inspection = inspectRequiredObservation(value);
  if (inspection.ok) throw new Error("expected the observation to be malformed");
  return inspection.failure;
}

describe("required observation malformed diagnostics", () => {
  it("accepts a well-formed observation", () => {
    expect(inspectRequiredObservation({ content: ["alpha", { score: 1 }] })).toMatchObject({ ok: true });
  });

  it("names a non-finite number by its path", () => {
    const failure = malformedFailure({ content: ["SECRET_MARKER_TEXT", { score: Number.NaN }] });
    expect(failure).toMatchObject({
      kind: "structural_safety",
      constraint: "malformed_json_structure",
      cause: "non_finite_number",
      path: "$.content[1].score",
    });
  });

  it("names an infinite number as non-finite", () => {
    expect(malformedFailure({ limit: Number.POSITIVE_INFINITY })).toMatchObject({
      cause: "non_finite_number",
      path: "$.limit",
    });
  });

  it("names a bigint member as an unsupported type", () => {
    expect(malformedFailure({ counts: { total: BigInt(3) } })).toMatchObject({
      cause: "unsupported_type",
      path: "$.counts.total",
    });
  });

  it("names an undefined member as an unsupported type", () => {
    expect(malformedFailure({ detail: { value: undefined } })).toMatchObject({
      cause: "unsupported_type",
      path: "$.detail.value",
    });
  });

  it("names a cycle at the node that closes it", () => {
    const loop: Record<string, unknown> = { items: [] };
    (loop.items as unknown[]).push({ back: loop });
    expect(malformedFailure(loop)).toMatchObject({
      cause: "cycle",
      path: "$.items[0].back",
    });
  });

  it("names a hole in a sparse array at the missing index", () => {
    const list: unknown[] = ["alpha", "beta", "gamma"];
    delete list[1];
    expect(malformedFailure({ list })).toMatchObject({
      cause: "array_shape",
      path: "$.list[1]",
    });
  });

  it("names an accessor array index without invoking it", () => {
    let invoked = false;
    const list: unknown[] = ["alpha", "beta"];
    Object.defineProperty(list, 0, { enumerable: true, get() { invoked = true; return "gamma"; } });
    expect(malformedFailure({ list })).toMatchObject({
      cause: "array_shape",
      path: "$.list[0]",
    });
    expect(invoked).toBe(false);
  });

  it("names a non-enumerable array index at that index", () => {
    const list: unknown[] = ["alpha", "beta"];
    Object.defineProperty(list, 1, { value: "gamma", enumerable: false });
    expect(malformedFailure({ list })).toMatchObject({
      cause: "array_shape",
      path: "$.list[1]",
    });
  });

  it("names extra enumerable array properties at the array", () => {
    const list: unknown[] = ["alpha"];
    Object.assign(list, { extra: "beta" });
    expect(malformedFailure({ list })).toMatchObject({
      cause: "array_shape",
      path: "$.list",
    });
  });

  it("names extra hidden array properties at the array", () => {
    const list: unknown[] = ["alpha"];
    Object.defineProperty(list, "hidden", { value: "beta", enumerable: false });
    expect(malformedFailure({ list })).toMatchObject({
      cause: "array_shape",
      path: "$.list",
    });
  });

  it("names a non-plain prototype at the object that has it", () => {
    expect(malformedFailure({ nested: new Map([["key", "value"]]) })).toMatchObject({
      cause: "non_plain_prototype",
      path: "$.nested",
    });
  });

  it("names symbol keys as hidden keys at the object", () => {
    const payload: Record<string | symbol, unknown> = { id: "alpha" };
    payload[Symbol("hidden")] = "beta";
    expect(malformedFailure({ payload })).toMatchObject({
      cause: "hidden_keys",
      path: "$.payload",
    });
  });

  it("names non-enumerable object keys as hidden keys at the object", () => {
    const payload: Record<string, unknown> = { id: "alpha" };
    Object.defineProperty(payload, "hidden", { value: "beta" });
    expect(malformedFailure({ payload })).toMatchObject({
      cause: "hidden_keys",
      path: "$.payload",
    });
  });

  it("names an accessor object key at that key without invoking it", () => {
    let invoked = false;
    const payload: Record<string, unknown> = { id: "alpha" };
    Object.defineProperty(payload, "lazy", { enumerable: true, get() { invoked = true; return "beta"; } });
    expect(malformedFailure({ payload })).toMatchObject({
      cause: "hidden_keys",
      path: "$.payload.lazy",
    });
    expect(invoked).toBe(false);
  });

  it("reports long keys as star and escapes keys that are not identifiers", () => {
    expect(malformedFailure({ ["k".repeat(41)]: { value: Number.NaN } }).path).toBe("$[\"*\"].value");
    expect(malformedFailure({ ["k".repeat(40)]: { value: Number.NaN } }).path).toBe(`$.${"k".repeat(40)}.value`);
    expect(malformedFailure({ "turn one": { value: Number.NaN } }).path).toBe("$[\"turn one\"].value");
  });

  it("truncates deep paths to 200 characters", () => {
    let node: Record<string, unknown> = { value: Number.NaN };
    for (let depth = 0; depth < 40; depth += 1) node = { segment: node };
    const { path } = malformedFailure(node);
    expect(path).toHaveLength(200);
    expect(path?.endsWith("...")).toBe(true);
    expect(path?.startsWith("$.segment.segment")).toBe(true);
  });

  it("never echoes value text in the diagnostic", () => {
    const marker = "PRIVATE_MARKER_TEXT";
    const malformedShapes: unknown[] = [
      { note: marker, score: Number.NaN },
      { note: marker, count: BigInt(1) },
      { note: marker, list: [marker, , marker] },
      { note: marker, payload: new Map([[marker, marker]]) },
      { note: marker, payload: { [Symbol(marker)]: marker } },
    ];
    for (const shape of malformedShapes) {
      expect(JSON.stringify(malformedFailure(shape))).not.toContain(marker);
    }
  });

  it("renders the cause and path into the overflow message detail", () => {
    const failure = malformedFailure({ content: [Number.NaN] });
    expect(malformedObservationDetail(failure)).toBe(", cause non_finite_number at $.content[0]");
    expect(malformedObservationDetail({
      kind: "structural_safety",
      constraint: "max_nesting_depth",
      measuredValue: 65,
      unit: "levels",
      limit: 64,
      stage: "observation_validation",
      measurementBasis: "exact",
    })).toBe("");
  });
});

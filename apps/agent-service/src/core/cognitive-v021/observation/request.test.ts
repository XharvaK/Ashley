import { describe, expect, it } from "vitest";
import { classifyOperation, createObservationRequest } from "./request.js";

describe("v0.2.1 observation/effect classification", () => {
  it("classifies reads as replay-safe observations", () => {
    expect(classifyOperation("project.read_file", {})).toBe("observation");
    expect(createObservationRequest({ cycleId: "c1", generation: 1, requestId: "r1", kind: "project.read_file", request: { path: "README.md" } })).toMatchObject({ replaySafe: true, cycleId: "c1" });
  });

  it("classifies writes and ambiguous operations as effects", () => {
    expect(classifyOperation("workspace.write_file", {})).toBe("effect");
    expect(classifyOperation("unknown_op", {})).toBe("effect");
  });
});

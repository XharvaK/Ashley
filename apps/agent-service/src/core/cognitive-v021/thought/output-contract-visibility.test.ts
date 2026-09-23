import { describe, expect, it } from "vitest";
import {
  REGISTERED_OPERATION_KINDS,
  thoughtOutputCompatibilityInstruction,
  thoughtOutputDeepSeekJsonObjectInstruction,
} from "./output-contract.js";

describe("candidate.develop contract legibility", () => {
  const instruction = thoughtOutputDeepSeekJsonObjectInstruction();
  const compatibility = thoughtOutputCompatibilityInstruction();

  it("adds exactly one generic canonical candidate.develop example", () => {
    const exampleLines = instruction
      .split("\n")
      .filter((line) => line.includes("candidate.develop"));
    expect(exampleLines).toHaveLength(1);
    const example = exampleLines[0]!;
    expect(example).toContain('"kind":"effect_intent"');
    expect(example).toContain('"operationKind":"candidate.develop"');
    expect(example).toContain('"projectId":"example-project"');
    // Generic and fixture-free.
    expect(example).not.toMatch(/pass3|pass 3|P5|QV2|bclp|qualification|fixture|saffron|px-41/i);
    // Shape only: no prescribed operation chain and no other operation name inside the example.
    expect(example).not.toContain("project.inspect");
    expect(example).not.toContain("workspace.verify");
    expect(example).not.toMatch(/inspect→|→develop|develop→/i);
  });

  it("keeps project.inspect described by plain read-only semantics, not inspect exclusivity", () => {
    expect(compatibility).toContain("project.inspect is read-only.");
    expect(compatibility).not.toContain("only current semantic project-read");
  });

  it("presents registered names as syntax vocabulary beneath the advertised capability surface", () => {
    expect(compatibility).toContain("syntax vocabulary");
    expect(compatibility).toContain("Registration is not permission");
    expect(compatibility).toContain("capabilityReality.operationCapabilities");
    for (const operation of REGISTERED_OPERATION_KINDS) {
      expect(compatibility).toContain(operation);
    }
    expect(compatibility).toContain("unavailable advertised capabilities cannot be dispatched");
  });
});

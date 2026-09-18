import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { bindObservationIntent } from "./operation-binding.js";

const primitiveRequests: Record<string, Record<string, unknown>> = {
  "project.read_file": { projectId: "project-ashley", path: "README.md" },
  "project.list_directory": { projectId: "project-ashley", path: "apps" },
  "project.search_text": { projectId: "project-ashley", pattern: "worker" },
  "project.investigate": { projectId: "project-ashley", focus: "worker" },
};

describe("Thought project operation boundary", () => {
  it.each(Object.entries(primitiveRequests))("rejects %s as a Thought operation", (operationKind, request) => {
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind,
      request,
      purpose: "obtain project evidence",
      evidenceNeed: "current bounded evidence",
      existingRefs: [],
    }, new Set())).toMatchObject({ ok: false, code: "operation_not_registered" });
  });

  it("accepts semantic project.inspect and binds only that route", () => {
    const intent = {
      kind: "observation_intent" as const,
      operationKind: "project.inspect",
      request: {
        projectId: "project-ashley",
        locator: { kind: "file", path: "README.md" },
        question: "what is the current contract?",
      },
      purpose: "obtain project evidence",
      evidenceNeed: "current bounded evidence",
      existingRefs: [],
    };
    const parsed = parseThoughtSemanticOutput(intent, new Set());
    expect(parsed).toMatchObject({ ok: true, value: { operationKind: "project.inspect" } });
    if (!parsed.ok) return;
    expect(bindObservationIntent({
      intent: parsed.value as typeof intent,
      cycleId: "cycle:project-inspect",
      generation: 1,
      parentDeadlineAtMs: 60_000,
      nowMs: 1_000,
    })).toMatchObject({ kind: "project.inspect", operationKind: "project.inspect" });
  });

  it("rejects a primitive even when a caller bypasses the parser", () => {
    expect(() => bindObservationIntent({
      intent: {
        kind: "observation_intent",
        operationKind: "project.read_file",
        request: { projectId: "project-ashley", path: "README.md" },
        purpose: "obtain project evidence",
        evidenceNeed: "current bounded evidence",
        existingRefs: [],
      },
      cycleId: "cycle:primitive-bypass",
      generation: 1,
      parentDeadlineAtMs: 60_000,
      nowMs: 1_000,
    })).toThrow("operation_not_registered");
  });
});

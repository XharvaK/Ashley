import { describe, expect, it } from "vitest";
import {
  THOUGHT_OUTPUT_SCHEMA,
  constrainThoughtOutputSchema,
  thoughtOutputCompatibilityInstruction,
} from "./output-contract.js";
import { INTERIM_SURFACE_DRAFT_MAX_LENGTH, parseThoughtSemanticOutput } from "./parse.js";
import { buildOperationalEffectNamespaceFromRefs } from "../effect/effect-ref.js";
import {
  ownerCoverageHash,
  resolveOwnerObligation,
  type OwnerDispatchCoverage,
} from "../owner-obligation.js";

const refs = new Set(["turn-1"]);

const investigate = {
  kind: "observation_intent",
  operationKind: "project.investigate",
  request: { projectId: "project-ashley", focus: "apps/agent-service" },
  purpose: "investigate the current project",
  evidenceNeed: "bounded file evidence",
  existingRefs: ["turn-1"],
};

const inspect = {
  kind: "observation_intent",
  operationKind: "project.inspect",
  request: { projectId: "project-ashley", operation: "project.read_file", path: "README.md" },
  purpose: "read one known file",
  evidenceNeed: "the file contents",
  existingRefs: ["turn-1"],
};

function coverage(overrides: Partial<OwnerDispatchCoverage> = {}): OwnerDispatchCoverage {
  const base = {
    primaryEventId: "owner-1",
    coveredOwnerEventIds: ["owner-1"],
    uncoveredOwnerEventIds: [],
  } satisfies Omit<OwnerDispatchCoverage, "coverageHash">;
  const value = { ...base, ...overrides };
  return { ...value, coverageHash: ownerCoverageHash(value) };
}

describe("interim-hold Thought contract", () => {
  it("accepts an observation intent without interim speech on investigate and inspect", () => {
    expect(parseThoughtSemanticOutput(investigate, refs)).toMatchObject({
      ok: true,
      value: { kind: "observation_intent", operationKind: "project.investigate" },
    });
    expect(parseThoughtSemanticOutput(inspect, refs)).toMatchObject({
      ok: true,
      value: { kind: "observation_intent", operationKind: "project.inspect" },
    });
  });

  it("accepts mode none and a bounded hold draft on project.investigate", () => {
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "none" } },
      refs,
    )).toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput(
      {
        ...investigate,
        interimSpeech: {
          mode: "hold",
          surfaceDraft: "Yeah, give me a bit. I'm going to look through it.",
        },
      },
      refs,
    )).toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput(
      {
        ...investigate,
        interimSpeech: {
          mode: "hold",
          surfaceDraft: "On it, looking now.",
          presentationDirectives: ["warm brevity"],
        },
      },
      refs,
    )).toMatchObject({ ok: true });
    expect(INTERIM_SURFACE_DRAFT_MAX_LENGTH).toBe(600);
  });

  it("rejects interim speech on project.inspect and every non-observation branch", () => {
    const hold = { mode: "hold", surfaceDraft: "Looking into it." };
    expect(parseThoughtSemanticOutput({ ...inspect, interimSpeech: hold }, refs)).toEqual({
      ok: false,
      code: "wrong_type",
      field: "interimSpeech",
    });
    expect(parseThoughtSemanticOutput({
      kind: "effect_intent",
      operationKind: "workspace.verify",
      request: { projectId: "project-ashley" },
      purpose: "verify",
      expectedOutcome: "verified",
      existingRefs: ["turn-1"],
      interimSpeech: hold,
    }, refs)).toEqual({ ok: false, code: "wrong_kind", field: "kind" });
    expect(parseThoughtSemanticOutput({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "Need more.",
      evidenceRefs: ["turn-1"],
      interimSpeech: hold,
    }, refs)).toEqual({ ok: false, code: "unknown_field", field: "interimSpeech" });
  });

  it("rejects malformed interim holds structurally", () => {
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "hold" } },
      refs,
    )).toEqual({ ok: false, code: "required_field_missing", field: "interimSpeech.surfaceDraft" });
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "hold", surfaceDraft: "" } },
      refs,
    )).toEqual({ ok: false, code: "wrong_type", field: "interimSpeech.surfaceDraft" });
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "hold", surfaceDraft: "x".repeat(601) } },
      refs,
    )).toEqual({ ok: false, code: "wrong_type", field: "interimSpeech.surfaceDraft" });
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "defer" } },
      refs,
    )).toEqual({ ok: false, code: "invalid_enum", field: "interimSpeech.mode" });
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "none", surfaceDraft: "extra" } },
      refs,
    )).toEqual({ ok: false, code: "unknown_field", field: "interimSpeech.surfaceDraft" });
    expect(parseThoughtSemanticOutput(
      { ...investigate, interimSpeech: { mode: "hold", surfaceDraft: "ok", findings: ["done"] } },
      refs,
    )).toEqual({ ok: false, code: "unknown_field", field: "interimSpeech.findings" });
  });

  it("exposes interimSpeech as an optional observation property in schema and wire bounds", () => {
    const schema = THOUGHT_OUTPUT_SCHEMA as {
      oneOf: Array<{ properties: Record<string, unknown>; required: string[] }>;
    };
    const observation = schema.oneOf.find(
      (branch) => (branch.properties.kind as { const?: string })?.const === "observation_intent",
    );
    expect(observation).toBeDefined();
    expect(Object.keys(observation?.properties ?? {}).sort()).toEqual(
      ["evidenceNeed", "existingRefs", "interimSpeech", "kind", "operationKind", "purpose", "request"],
    );
    expect(observation?.required).toEqual(
      ["kind", "operationKind", "request", "purpose", "evidenceNeed", "existingRefs"],
    );

    const constrained = constrainThoughtOutputSchema(buildOperationalEffectNamespaceFromRefs([]));
    const wire = constrained.schema as {
      oneOf: Array<{ properties: Record<string, { oneOf?: Array<{ properties: Record<string, unknown>; required?: string[] }> }> }>;
    };
    const wireObservation = wire.oneOf.find(
      (branch) => (branch.properties.kind as unknown as { const?: string })?.const === "observation_intent",
    );
    const hold = wireObservation?.properties.interimSpeech?.oneOf?.find(
      (form) => (form.properties.mode as { const?: string })?.const === "hold",
    );
    expect(hold?.required).toContain("surfaceDraft");
    expect(hold?.properties.surfaceDraft).toMatchObject({ type: "string", minLength: 1, maxLength: 600 });
  });

  it("teaches the interim-hold law and investigate guidance in compatibility instruction", () => {
    const instruction = thoughtOutputCompatibilityInstruction();
    expect(instruction).toContain("Interim-hold law");
    expect(instruction).toContain("operation_pending");
    expect(instruction).toContain("project.investigate is the multi-step adaptive bounded investigation objective");
  });
});

describe("detached operation Owner obligation", () => {
  it("transfers a deferred detached yield to operation_pending under the detached successor", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "deferred",
      detachedOperationId: "detached-operation:abc123",
      interimSpeechAuthored: true,
    });
    expect(result).toMatchObject({
      ownerObligationOutcome: "transferred",
      successorIdentity: "detached_operation:detached-operation:abc123",
      remainingResponsibility: "operation_pending",
      deliveryDisposition: "delivery_pending",
    });
  });

  it("keeps generic deferred continuation when no detached operation exists", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "deferred",
    });
    expect(result).toMatchObject({
      ownerObligationOutcome: "unresolved",
      successorIdentity: null,
      remainingResponsibility: "deferred_continuation",
    });
  });

  it("marks no delivery pending when Thought yielded without an interim draft", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "deferred",
      detachedOperationId: "detached-operation:abc123",
    });
    expect(result).toMatchObject({
      remainingResponsibility: "operation_pending",
      deliveryDisposition: "not_applicable",
    });
  });
});

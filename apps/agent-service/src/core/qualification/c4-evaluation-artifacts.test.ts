import { describe, expect, it } from "vitest";
import {
  assertIndependentC4EvaluationPair,
  createC4EvaluationDefinition,
  createC4QualificationResult,
} from "./c4-evaluation-artifacts.js";

function definition(dimension: "epistemic" | "lived_experience") {
  return createC4EvaluationDefinition({
    definitionId: "c4-" + dimension,
    version: 1,
    subject: "c4-fixture-subject",
    dimension,
    privacyClass: "never_public",
    thresholds: { minimum_witnesses: 2 },
    invariants: ["no_global_confidence", "future_only_calibration"],
  });
}

function result(
  dimension: "epistemic" | "lived_experience",
  status: "passed" | "failed" | "inconclusive",
) {
  return createC4QualificationResult({
    definition: definition(dimension),
    sourceCommit: "c4-fixture-sha",
    dirty: false,
    environment: { runner: "local-fixture" },
    evidenceRefs: ["test-witness:" + dimension],
    evidenceHashes: ["sha256:" + dimension],
    invariantResults: { no_global_confidence: status === "passed" },
    thresholdResults: { minimum_witnesses: status === "passed" },
    status,
    limitations: ["fixture only; no production qualification"],
  });
}

describe("C4 independent EvaluationDefinition and QualificationResult artifacts", () => {
  it("binds immutable definition and result hashes without copying beliefs or scores", () => {
    const epistemicDefinition = definition("epistemic");
    const epistemic = result("epistemic", "passed");
    expect(Object.isFrozen(epistemicDefinition)).toBe(true);
    expect(Object.isFrozen(epistemic)).toBe(true);
    expect(epistemic).toMatchObject({
      artifactType: "QualificationResult",
      dimension: "epistemic",
      sourceCommit: "c4-fixture-sha",
      dirty: false,
    });
    expect(epistemic.artifactHash).toMatch(/^sha256:/);
    expect(epistemic).not.toHaveProperty("confidence");
    expect(epistemic).not.toHaveProperty("score");
  });

  it("requires both independent dimensions and never averages a deterministic failure away", () => {
    const passed = assertIndependentC4EvaluationPair(
      result("epistemic", "passed"),
      result("lived_experience", "passed"),
    );
    expect(passed.overall).toBe("qualified");
    const failed = assertIndependentC4EvaluationPair(
      result("epistemic", "failed"),
      result("lived_experience", "passed"),
    );
    expect(failed.overall).toBe("not_qualified");
    expect(() => assertIndependentC4EvaluationPair(
      result("epistemic", "passed"),
      result("epistemic", "passed"),
    )).toThrow("c4_evaluation_independent_dimensions_required");
  });

  it("requires bound evidence and exact source cleanliness metadata", () => {
    expect(() => createC4QualificationResult({
      definition: definition("epistemic"),
      sourceCommit: "",
      dirty: false,
      environment: {},
      evidenceRefs: ["witness"],
      evidenceHashes: ["hash"],
      invariantResults: {},
      thresholdResults: {},
      status: "passed",
      limitations: [],
    })).toThrow("c4_evaluation_source_commit_required");
    expect(() => createC4QualificationResult({
      definition: definition("epistemic"),
      sourceCommit: "sha",
      dirty: false,
      environment: {},
      evidenceRefs: ["witness"],
      evidenceHashes: ["hash"],
      invariantResults: {},
      thresholdResults: {},
      status: "passed",
      limitations: [],
    })).not.toThrow();
    expect(() => createC4QualificationResult({
      definition: definition("epistemic"),
      sourceCommit: "sha",
      dirty: false,
      environment: {},
      evidenceRefs: ["witness"],
      evidenceHashes: ["hash"],
      invariantResults: { no_global_confidence: false },
      thresholdResults: { minimum_witnesses: true },
      status: "passed",
      limitations: [],
    })).toThrow("c4_evaluation_pass_with_failed_witness");
  });
});

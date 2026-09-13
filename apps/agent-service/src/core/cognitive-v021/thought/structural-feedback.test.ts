import { describe, expect, it } from "vitest";
import {
  LOCALIZED_STRUCTURAL_CORRECTION_CODES,
  createThoughtStructuralFeedback,
  formatThoughtStructuralCorrectionData,
  formatThoughtStructuralFeedback,
  validateThoughtStructuralCorrectionScope,
} from "./structural-feedback.js";

const abstainCandidate = {
  kind: "abstain",
  reason: "insufficient_evidence",
  explanation: "The supplied evidence is not enough.",
  evidenceRefs: ["not-allowlisted"],
} as const;

describe("Thought structural correction scope", () => {
  it("carries the model-authored candidate as data for a localized repair", () => {
    const feedback = createThoughtStructuralFeedback({
      code: "reference_not_allowlisted",
      field: "evidenceRefs",
      allowlistedReferences: ["turn-1"],
      previousCandidate: abstainCandidate,
    });

    expect(feedback.correctionScope).toBe("localized");
    expect(feedback.allowedRepairPath).toBe("evidenceRefs");
    expect(feedback.previousCandidate).toEqual(abstainCandidate);

    const correctionData = JSON.parse(formatThoughtStructuralCorrectionData(feedback) ?? "null") as {
      structuralCorrection: {
        candidateRole: string;
        previousCandidate: unknown;
        failureCode: string;
        failingPath: string;
        allowedRepairScope: { kind: string; path: string };
        hostAllowlistedReferenceIds: string[];
      };
    };
    expect(correctionData.structuralCorrection).toMatchObject({
      candidateRole: "model_authored_data",
      previousCandidate: abstainCandidate,
      failureCode: "reference_not_allowlisted",
      failingPath: "evidenceRefs",
      allowedRepairScope: { kind: "localized", path: "evidenceRefs" },
      hostAllowlistedReferenceIds: ["turn-1"],
    });
    expect(correctionData.structuralCorrection).not.toHaveProperty("replacementCandidate");
    expect(formatThoughtStructuralFeedback(feedback)).not.toContain("not-allowlisted");
  });

  it("accepts only the reported subtree and preserves the model-selected kind", () => {
    const feedback = createThoughtStructuralFeedback({
      code: "reference_not_allowlisted",
      field: "evidenceRefs",
      allowlistedReferences: ["turn-1"],
      previousCandidate: abstainCandidate,
    });

    expect(validateThoughtStructuralCorrectionScope(feedback, {
      ...abstainCandidate,
      evidenceRefs: ["turn-1"],
    })).toEqual({ ok: true });

    const kindDrift = validateThoughtStructuralCorrectionScope(feedback, {
      ...abstainCandidate,
      kind: "settlement",
      evidenceRefs: ["turn-1"],
    });
    expect(kindDrift.ok).toBe(false);
    if (!kindDrift.ok) {
      expect(kindDrift.violation.code).toBe("structural_correction_scope_violation");
      expect(kindDrift.violation.changedPaths).toContain("kind");
    }

    const unrelatedDrift = validateThoughtStructuralCorrectionScope(feedback, {
      ...abstainCandidate,
      explanation: "A different semantic answer.",
      evidenceRefs: ["turn-1"],
    });
    expect(unrelatedDrift.ok).toBe(false);
    if (!unrelatedDrift.ok) {
      expect(unrelatedDrift.violation.changedPaths).toContain("explanation");
    }
  });

  it("classifies only field-localizable parser failures as localized", () => {
    const fields = {
      wrong_type: "explanation",
      invalid_enum: "reason",
      reference_not_allowlisted: "evidenceRefs",
      operation_not_registered: "operationKind",
    } as const;
    expect(LOCALIZED_STRUCTURAL_CORRECTION_CODES).toEqual([
      "wrong_type",
      "invalid_enum",
      "reference_not_allowlisted",
      "operation_not_registered",
    ]);
    for (const code of LOCALIZED_STRUCTURAL_CORRECTION_CODES) {
      const feedback = createThoughtStructuralFeedback({
        code,
        field: fields[code],
        previousCandidate: abstainCandidate,
      });
      expect(feedback.correctionScope, code).toBe("localized");
      expect(feedback.previousCandidate, code).toEqual(abstainCandidate);
      const drift = validateThoughtStructuralCorrectionScope(feedback, {
        ...abstainCandidate,
        kind: "settlement",
      });
      expect(drift.ok, code).toBe(false);
      if (!drift.ok) expect(drift.violation.changedPaths, code).toContain("kind");
    }
  });

  it("keeps invalid JSON, non-object roots, and wrong kinds on bounded global regeneration", () => {
    for (const code of ["invalid_json", "root_not_object", "wrong_kind"] as const) {
      const feedback = createThoughtStructuralFeedback({
        code,
        field: code === "wrong_kind" ? "kind" : undefined,
        previousCandidate: abstainCandidate,
      });
      expect(feedback.correctionScope, code).toBe("global");
      expect(feedback.previousCandidate, code).toBeNull();
      expect(formatThoughtStructuralCorrectionData(feedback), code).toBeNull();
      expect(validateThoughtStructuralCorrectionScope(feedback, {
        ...abstainCandidate,
        kind: "settlement",
      }), code).toEqual({ ok: true });
    }
  });

  it("keeps post-parse materialization failures on global regeneration", () => {
    for (const code of [
      "alias_duplicate",
      "dangling_local_reference",
      "reference_target_type_mismatch",
      "commitment_binding_invalid",
    ] as const) {
      const feedback = createThoughtStructuralFeedback({
        code,
        field: "workingContextDeltas[0].item.concernRef",
        previousCandidate: abstainCandidate,
      });
      expect(feedback.correctionScope, code).toBe("global");
      expect(feedback.previousCandidate, code).toBeNull();
      expect(formatThoughtStructuralCorrectionData(feedback), code).toBeNull();
      expect(formatThoughtStructuralFeedback(feedback), code).toContain(code);
    }
  });
});

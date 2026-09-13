import { createHash, randomUUID } from "node:crypto";

export type C4EvaluationDimension = "epistemic" | "lived_experience";
export type C4QualificationStatus = "passed" | "failed" | "inconclusive";

export type C4EvaluationDefinition = Readonly<{
  artifactType: "EvaluationDefinition";
  definitionId: string;
  version: number;
  subject: string;
  dimension: C4EvaluationDimension;
  privacyClass: "ordinary" | "sensitive" | "never_public";
  thresholds: Readonly<Record<string, number>>;
  invariants: readonly string[];
  definitionHash: string;
}>;

export type C4QualificationResult = Readonly<{
  artifactType: "QualificationResult";
  artifactId: string;
  artifactHash: string;
  subject: string;
  dimension: C4EvaluationDimension;
  definitionId: string;
  definitionVersion: number;
  definitionHash: string;
  sourceCommit: string;
  dirty: boolean;
  environment: Readonly<Record<string, string>>;
  evidenceRefs: readonly string[];
  evidenceHashes: readonly string[];
  invariantResults: Readonly<Record<string, boolean>>;
  thresholdResults: Readonly<Record<string, boolean>>;
  status: C4QualificationStatus;
  limitations: readonly string[];
}>;

export type C4IndependentEvaluationPair = Readonly<{
  independent: true;
  subject: string;
  epistemic: C4QualificationResult;
  livedExperience: C4QualificationResult;
  overall: "qualified" | "not_qualified";
}>;

function requireText(value: unknown, name: string, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error("c4_evaluation_" + name + "_required");
  if (result.length > max) throw new Error("c4_evaluation_" + name + "_too_long");
  return result;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort()
    .map((key) => JSON.stringify(key) + ":" + stable(record[key]))
    .join(",") + "}";
}

function hash(value: unknown): string {
  return "sha256:" + createHash("sha256").update(stable(value)).digest("hex");
}

function dimension(value: unknown): C4EvaluationDimension | null {
  return value === "epistemic" || value === "lived_experience" ? value : null;
}

function boundedStringMap(value: Record<string, string> | undefined, name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    const cleanKey = requireText(key, name + "_key", 80);
    result[cleanKey] = requireText(item, name + "_value", 300);
  }
  if (JSON.stringify(result).length > 4000) throw new Error("c4_evaluation_" + name + "_too_large");
  return result;
}

function boundedBooleanMap(value: Record<string, boolean> | undefined, name: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    result[requireText(key, name + "_key", 80)] = item === true;
  }
  return result;
}

export function createC4EvaluationDefinition(input: {
  definitionId: string;
  version: number;
  subject: string;
  dimension: C4EvaluationDimension;
  privacyClass?: "ordinary" | "sensitive" | "never_public";
  thresholds: Record<string, number>;
  invariants: string[];
}): C4EvaluationDefinition {
  const rowDimension = dimension(input.dimension);
  if (!rowDimension) throw new Error("c4_evaluation_dimension_invalid");
  if (!Number.isSafeInteger(input.version) || input.version <= 0) throw new Error("c4_evaluation_version_invalid");
  const thresholds: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.thresholds ?? {})) {
    const cleanKey = requireText(key, "threshold_key", 80);
    if (!Number.isFinite(value)) throw new Error("c4_evaluation_threshold_invalid");
    thresholds[cleanKey] = value;
  }
  const invariants = (input.invariants ?? []).map((item) => requireText(item, "invariant", 300));
  if (invariants.length === 0) throw new Error("c4_evaluation_invariants_required");
  const base = {
    artifactType: "EvaluationDefinition" as const,
    definitionId: requireText(input.definitionId, "definition_id", 120),
    version: input.version,
    subject: requireText(input.subject, "subject", 300),
    dimension: rowDimension,
    privacyClass: input.privacyClass ?? "never_public",
    thresholds,
    invariants,
  };
  return Object.freeze({ ...base, definitionHash: hash(base) });
}

export function createC4QualificationResult(input: {
  definition: C4EvaluationDefinition;
  artifactId?: string;
  sourceCommit: string;
  dirty: boolean;
  environment: Record<string, string>;
  evidenceRefs: string[];
  evidenceHashes: string[];
  invariantResults: Record<string, boolean>;
  thresholdResults: Record<string, boolean>;
  status: C4QualificationStatus;
  limitations: string[];
}): C4QualificationResult {
  const definition = input.definition;
  if (!definition || definition.artifactType !== "EvaluationDefinition") throw new Error("c4_evaluation_definition_required");
  if (!dimension(definition.dimension)) throw new Error("c4_evaluation_dimension_invalid");
  if (input.status !== "passed" && input.status !== "failed" && input.status !== "inconclusive") {
    throw new Error("c4_evaluation_status_invalid");
  }
  const evidenceRefs = (input.evidenceRefs ?? []).map((item) => requireText(item, "evidence_ref", 300));
  const evidenceHashes = (input.evidenceHashes ?? []).map((item) => requireText(item, "evidence_hash", 200));
  if (evidenceRefs.length === 0 || evidenceRefs.length !== evidenceHashes.length) {
    throw new Error("c4_evaluation_evidence_binding_invalid");
  }
  const resultBase = {
    artifactType: "QualificationResult" as const,
    artifactId: requireText(input.artifactId ?? randomUUID(), "artifact_id", 120),
    subject: definition.subject,
    dimension: definition.dimension,
    definitionId: definition.definitionId,
    definitionVersion: definition.version,
    definitionHash: definition.definitionHash,
    sourceCommit: requireText(input.sourceCommit, "source_commit", 200),
    dirty: input.dirty === true,
    environment: boundedStringMap(input.environment, "environment"),
    evidenceRefs,
    evidenceHashes,
    invariantResults: boundedBooleanMap(input.invariantResults, "invariant"),
    thresholdResults: boundedBooleanMap(input.thresholdResults, "threshold"),
    status: input.status,
    limitations: (input.limitations ?? []).map((item) => requireText(item, "limitation", 500)),
  };
  const invariantsOk = Object.values(resultBase.invariantResults).every((value) => value);
  const thresholdsOk = Object.values(resultBase.thresholdResults).every((value) => value);
  if (input.status === "passed" && (!invariantsOk || !thresholdsOk)) {
    throw new Error("c4_evaluation_pass_with_failed_witness");
  }
  return Object.freeze({ ...resultBase, artifactHash: hash(resultBase) });
}

/** Independent dimensions are conjunctive; no score or averaging is exposed. */
export function assertIndependentC4EvaluationPair(
  epistemic: C4QualificationResult,
  livedExperience: C4QualificationResult,
): C4IndependentEvaluationPair {
  if (epistemic.dimension !== "epistemic" || livedExperience.dimension !== "lived_experience") {
    throw new Error("c4_evaluation_independent_dimensions_required");
  }
  if (epistemic.subject !== livedExperience.subject) {
    throw new Error("c4_evaluation_subject_mismatch");
  }
  return Object.freeze({
    independent: true as const,
    subject: epistemic.subject,
    epistemic,
    livedExperience,
    overall: epistemic.status === "passed" && livedExperience.status === "passed"
      ? "qualified"
      : "not_qualified",
  });
}

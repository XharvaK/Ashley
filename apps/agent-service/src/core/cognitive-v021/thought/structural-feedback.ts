import type {
  ThoughtCorrectionFailureCode,
  ThoughtParserFailureCode,
} from "../types.js";
import { buildReferenceAllowlist } from "./reference-allowlist.js";

export type ThoughtStructuralCandidate = Readonly<Record<string, unknown>>;

export const LOCALIZED_STRUCTURAL_CORRECTION_CODES = [
  "wrong_type",
  "invalid_enum",
  "reference_not_allowlisted",
  "operation_not_registered",
] as const satisfies readonly ThoughtParserFailureCode[];

type StructuralCorrectionScope = "localized" | "global";

export type ThoughtStructuralCorrectionScopeViolation = Readonly<{
  code: ThoughtCorrectionFailureCode;
  allowedPath: string;
  changedPaths: readonly string[];
  previousKind: string | null;
  correctedKind: string | null;
}>;

export type ThoughtStructuralCorrectionValidation =
  | { ok: true }
  | { ok: false; violation: ThoughtStructuralCorrectionScopeViolation };

export type ThoughtStructuralFeedback = Readonly<{
  code: ThoughtParserFailureCode;
  field: string | null;
  allowlistedReferences: readonly string[];
  correctionScope: StructuralCorrectionScope;
  allowedRepairPath: string | null;
  previousCandidate: ThoughtStructuralCandidate | null;
}>;

export type StructuralFeedbackInput = ThoughtStructuralFeedback | ThoughtParserFailureCode;

const STRUCTURAL_FEEDBACK: Readonly<Record<ThoughtParserFailureCode, string>> = {
  invalid_json: "Return exactly one JSON object.",
  root_not_object: "Return a JSON object at the root.",
  wrong_kind: "Use one permitted semantic Thought kind.",
  unknown_field: "Remove fields not defined by the active semantic Thought contract.",
  required_field_missing: "Include every required semantic Thought field.",
  wrong_type: "Use the required semantic field types without coercion.",
  empty_when_present: "Omit unused optional domains; present arrays must contain at least one item and composites a meaningful child.",
  invalid_enum: "Use one permitted value for the reported enum field.",
  reference_not_allowlisted: "Use only host allowlisted reference IDs for the reported reference field; do not invent, transform, or namespace references.",
  alias_invalid: "Use a valid output-local alias shape.",
  alias_collides_with_existing_ref: "Use an output-local alias that does not match an existing reference.",
  operation_not_registered: "Use one registered operation kind.",
  identity_missing: "Include every required Thought identity field.",
  identity_mismatch: "Preserve the active Thought identity fields.",
  missing_settlement_fields: "Include all required settlement sections.",
  speech_contract_failure: "Emit the required speech object shape.",
  commitment_contract_failure: "Emit the required commitments object shape.",
  commitment_binding_invalid: "Bind each epistemic surfaceSpan exactly once to the authored surfaceDraft without overlap, and declare every claim observationRef in evidenceUse.observationRefsUsed.",
  operations_contract_failure: "Use the semantic evidenceUse object shape.",
  authority_contract_failure: "Do not emit kernel-owned authority fields.",
  observation_contract_failure: "Emit the required observation request shape.",
  effect_contract_failure: "Emit the required effect proposal shape.",
  forbidden_fields: "Omit publication and delivery fields.",
  schema_version_mismatch: "Use the active Thought schema version.",
  alias_duplicate: "Use a distinct output-local alias for each same-settlement entity.",
  dangling_local_reference: "Use only local aliases declared by a same-settlement entity or an allowlisted existing reference.",
  reference_target_type_mismatch: "Use a local or existing reference whose target domain matches the reported field.",
  future_trigger_snapshot_unavailable: "Create a future trigger only for a concern whose Host-captured snapshot is available.",
  other: "Match the semantic Thought contract exactly.",
};

const PERMITTED_SEMANTIC_KINDS = new Set([
  "settlement",
  "observation_intent",
  "effect_intent",
  "abstain",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateValue(value: string | unknown): ThoughtStructuralCandidate | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record(parsed) || typeof parsed.kind !== "string" || !PERMITTED_SEMANTIC_KINDS.has(parsed.kind)) {
    return null;
  }
  return parsed;
}

export function parseThoughtStructuralCandidate(
  raw: string | unknown,
): ThoughtStructuralCandidate | null {
  return candidateValue(raw);
}

function isLocalizedCode(code: ThoughtParserFailureCode): boolean {
  return (LOCALIZED_STRUCTURAL_CORRECTION_CODES as readonly string[]).includes(code);
}

export function createThoughtStructuralFeedback(input: {
  code: ThoughtParserFailureCode;
  field?: string;
  allowlistedReferences?: readonly string[];
  previousCandidate?: string | unknown;
}): ThoughtStructuralFeedback {
  const allowlistedReferences = input.code === "reference_not_allowlisted"
    ? Object.freeze([
        ...buildReferenceAllowlist(input.allowlistedReferences ?? []).existing,
      ].sort())
    : Object.freeze([]);
  const previousCandidate = input.previousCandidate === undefined
    ? null
    : candidateValue(input.previousCandidate);
  const localized = Boolean(input.field)
    && previousCandidate !== null
    && isLocalizedCode(input.code);
  return Object.freeze({
    code: input.code,
    field: input.field ?? null,
    allowlistedReferences,
    correctionScope: localized ? "localized" : "global",
    allowedRepairPath: localized ? input.field ?? null : null,
    previousCandidate: localized ? previousCandidate : null,
  });
}

export function normalizeThoughtStructuralFeedback(
  input: StructuralFeedbackInput,
): ThoughtStructuralFeedback {
  if (typeof input === "string") return createThoughtStructuralFeedback({ code: input });
  return input;
}

function pathSegments(path: string): Array<string | number> {
  return (path.match(/[^.[\]]+/g) ?? []).map((part) => /^\d+$/.test(part) ? Number(part) : part);
}

function pathIsInside(path: readonly (string | number)[], allowed: readonly (string | number)[]): boolean {
  return path.length >= allowed.length && allowed.every((segment, index) => segment === path[index]);
}

function renderPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, segment, index) =>
    typeof segment === "number"
      ? `${result}[${segment}]`
      : index === 0 ? segment : `${result}.${segment}`,
  "");
}

function collectChangedPaths(
  previous: unknown,
  corrected: unknown,
  path: readonly (string | number)[],
  allowed: readonly (string | number)[],
  changed: string[],
): void {
  if (pathIsInside(path, allowed)) return;
  if (Object.is(previous, corrected)) return;

  if (Array.isArray(previous) && Array.isArray(corrected)) {
    if (previous.length !== corrected.length) {
      changed.push(renderPath(path));
      return;
    }
    for (let index = 0; index < previous.length; index += 1) {
      collectChangedPaths(previous[index], corrected[index], [...path, index], allowed, changed);
    }
    return;
  }

  if (record(previous) && record(corrected)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(corrected)]);
    for (const key of [...keys].sort()) {
      collectChangedPaths(previous[key], corrected[key], [...path, key], allowed, changed);
    }
    return;
  }

  changed.push(renderPath(path));
}

export function validateThoughtStructuralCorrectionScope(
  input: StructuralFeedbackInput,
  correctedCandidate: string | unknown,
): ThoughtStructuralCorrectionValidation {
  const feedback = normalizeThoughtStructuralFeedback(input);
  if (feedback.correctionScope !== "localized" || !feedback.allowedRepairPath || !feedback.previousCandidate) {
    return { ok: true };
  }

  const corrected = candidateValue(correctedCandidate);
  const previousKind = typeof feedback.previousCandidate.kind === "string"
    ? feedback.previousCandidate.kind
    : null;
  const correctedKind = corrected && typeof corrected.kind === "string" ? corrected.kind : null;
  const allowed = pathSegments(feedback.allowedRepairPath);
  const changedPaths: string[] = [];
  if (!corrected || previousKind !== correctedKind) {
    changedPaths.push("kind");
  } else {
    collectChangedPaths(feedback.previousCandidate, corrected, [], allowed, changedPaths);
  }
  const uniqueChangedPaths = [...new Set(changedPaths)];
  return uniqueChangedPaths.length === 0
    ? { ok: true }
    : {
        ok: false,
        violation: Object.freeze({
          code: "structural_correction_scope_violation" as const,
          allowedPath: feedback.allowedRepairPath,
          changedPaths: Object.freeze(uniqueChangedPaths),
          previousKind,
          correctedKind,
        }),
      };
}

export function formatThoughtStructuralFeedback(
  input: StructuralFeedbackInput | undefined,
): string | null {
  if (!input) return null;
  const feedback = normalizeThoughtStructuralFeedback(input);
  const field = feedback.field
    ? ` Failing field/path: ${feedback.field}.`
    : "";
  const allowlist = feedback.code === "reference_not_allowlisted"
    ? ` Host allowlisted reference IDs: ${JSON.stringify(feedback.allowlistedReferences)}.`
    : "";
  const scope = feedback.correctionScope === "localized" && feedback.allowedRepairPath
    ? ` Only ${feedback.allowedRepairPath} may change; preserve the semantic kind and every other field exactly.`
    : " This is a bounded global structural regeneration; no prior semantic candidate is supplied as a repair target.";
  return `The previous response failed bounded structural validation (${feedback.code}).${field} ${STRUCTURAL_FEEDBACK[feedback.code]}${allowlist}${scope} Do not change the semantic answer or invent authority.`;
}

export function formatThoughtStructuralCorrectionData(
  input: StructuralFeedbackInput | undefined,
): string | null {
  if (!input) return null;
  const feedback = normalizeThoughtStructuralFeedback(input);
  if (feedback.correctionScope !== "localized"
    || !feedback.allowedRepairPath
    || !feedback.previousCandidate) {
    return null;
  }
  return JSON.stringify({
    structuralCorrection: {
      candidateRole: "model_authored_data",
      previousCandidate: feedback.previousCandidate,
      failureCode: feedback.code,
      failingPath: feedback.field,
      constraint: STRUCTURAL_FEEDBACK[feedback.code],
      allowedRepairScope: {
        kind: "localized",
        path: feedback.allowedRepairPath,
        preserveOutsidePath: true,
      },
      hostAllowlistedReferenceIds: [...feedback.allowlistedReferences],
    },
  });
}

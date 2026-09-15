import {
  ARCHITECTURE_EPOCH,
  MAX_AUTHORITY_REVISIONS,
  SETTLEMENT_SCHEMA_VERSION,
  type AuthorityEpoch,
  type Generation,
  type OccupantId,
  type ThoughtSettlementDraft,
} from "../types.js";
import { isCommitmentsEnabled } from "../../relationship/commitment-admission.js";

export type SettlementValidationKind = "ok" | "malformed" | "stale" | "conflict";

export type SettlementValidationActiveIdentity = {
  cycleId: string;
  generation: Generation;
  occupantId: OccupantId;
  authorityEpoch: AuthorityEpoch;
  consumedEffectIds?: string[];
  effectReceiptIds?: string[];
  effectAllowlist?: ReadonlySet<string>;
};

export type ThoughtSettlementValidation =
  | { ok: true; kind: "ok"; draft: ThoughtSettlementDraft }
  | {
      ok: false;
      kind: Exclude<SettlementValidationKind, "ok">;
      codes: string[];
      error: string;
    };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function hasAll(value: RecordValue, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

const PUBLISHED_ONLY_FIELDS = new Set([
  "finalLicensedText",
  "settlementId",
  "outboxId",
  "nuclearReservationId",
  "deliveryState",
  "sendStatus",
  "discordMessageIds",
  "deliveryIntent",
  "projectionKey",
  "suppressed",
  "origin",
  "commitmentBindings",
]);

const CANONICAL_CONVERSATIONAL_COMMITMENTS = new Set([
  "answer",
  "ask",
  "acknowledge",
  "disagree",
  "hold",
  "silence",
]);

function containsPublishedOnlyField(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsPublishedOnlyField(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (PUBLISHED_ONLY_FIELDS.has(key)) return key;
    const found = containsPublishedOnlyField(nested);
    if (found) return found;
  }
  return null;
}

function failure(
  kind: Exclude<SettlementValidationKind, "ok">,
  ...codes: string[]
): ThoughtSettlementValidation {
  return { ok: false, kind, codes, error: codes.join(",") };
}

function validateIdentity(
  draft: RecordValue,
  active?: SettlementValidationActiveIdentity,
): ThoughtSettlementValidation | null {
  if (!isString(draft.cycleId) || !Number.isInteger(draft.generation)) {
    return failure("malformed", "IDENTITY_MISSING");
  }
  if (draft.architectureEpoch !== ARCHITECTURE_EPOCH) {
    return failure("malformed", "ARCHITECTURE_EPOCH_MISMATCH");
  }
  if (!isString(draft.occupantId) || !Number.isInteger(draft.authorityEpoch)) {
    return failure("malformed", "IDENTITY_MISSING");
  }
  if (!active) return null;
  if (draft.cycleId !== active.cycleId || draft.generation !== active.generation) {
    return failure("stale", "STALE_GENERATION");
  }
  if (
    draft.occupantId !== active.occupantId ||
    draft.authorityEpoch !== active.authorityEpoch
  ) {
    return failure("malformed", "ACTIVE_IDENTITY_MISMATCH");
  }
  return null;
}

function validateSpeech(value: unknown): ThoughtSettlementValidation | null {
  if (!isRecord(value) || !hasAll(value, ["mode"])) {
    return failure("malformed", "SPEECH_MISSING");
  }
  for (const key of ["mustSay", "mustNot", "acceptableRealizations", "presentationDirectives"]) {
    if (value[key] !== undefined && !isStringArray(value[key])) {
      return failure("malformed", "SPEECH_ARRAY_INVALID");
    }
  }
  if (value.mode === "draft") {
    if (!isString(value.surfaceDraft) || value.surfaceDraft.trim().length === 0) {
      return failure("malformed", "DRAFT_SURFACE_REQUIRED");
    }
  } else if (value.mode === "none") {
    if (value.surfaceDraft !== null) return failure("malformed", "NONE_SURFACE_FORBIDDEN");
  } else {
    return failure("malformed", "SPEECH_MODE_INVALID");
  }
  return null;
}

function validateCommitments(
  value: unknown,
  active?: SettlementValidationActiveIdentity,
): ThoughtSettlementValidation | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return failure("malformed", "COMMITMENTS_MISSING");
  const operational = value.operational;
  if (operational !== undefined && !Array.isArray(operational)) return failure("malformed", "OPERATIONAL_COMMITMENT_INVALID");
  for (const item of (operational ?? [])) {
    if (!isRecord(item) || !isString(item.effectRef) || item.effectRef.trim().length === 0) {
      return failure("malformed", "OPERATIONAL_COMMITMENT_INVALID");
    }
    if (!["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"].includes(String(item.claimedState))) {
      return failure("malformed", "OPERATIONAL_CLAIMED_STATE_INVALID");
    }
    if (active?.effectAllowlist && !active.effectAllowlist.has(item.effectRef)) {
      return failure("conflict", "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN");
    }
  }
  if (value.epistemic !== undefined) {
    if (!Array.isArray(value.epistemic) || !value.epistemic.every((item) => {
      if (!isRecord(item)) return false;
      return isString(item.statement) && isRecord(item.dimensions);
    })) {
      return failure("malformed", "EPISTEMIC_COMMITMENT_INVALID");
    }
  }
  if (
    value.conversational !== undefined
    && (!isStringArray(value.conversational)
      || value.conversational.some((item) => !CANONICAL_CONVERSATIONAL_COMMITMENTS.has(item)))
  ) return failure("malformed", "CONVERSATIONAL_COMMITMENT_INVALID");
  if (value.commitmentProposals !== undefined) {
    if (!isCommitmentsEnabled() || !Array.isArray(value.commitmentProposals) || value.commitmentProposals.length === 0 || value.commitmentProposals.length > 8) {
      return failure("conflict", "commitment_contract_failure");
    }
    const ordinals = new Set<number>();
    for (const item of value.commitmentProposals) {
      if (!isRecord(item)) return failure("malformed", "COMMITMENT_PROPOSAL_INVALID");
      const allowed = ["ordinal", "action", "beneficiary", "destination", "temporal", "realizationClause", "thoughtCycle"];
      if (Object.keys(item).some((key) => !allowed.includes(key)) || !hasAll(item, allowed)) {
        return failure("malformed", "COMMITMENT_PROPOSAL_INVALID");
      }
      if (typeof item.ordinal !== "number" || !Number.isInteger(item.ordinal) || item.ordinal < 0 || item.ordinal > 7
        || ordinals.has(item.ordinal)
        || !isString(item.action) || item.action.trim().length === 0
        || !(item.beneficiary === "owner" || (isString(item.beneficiary) && item.beneficiary.trim().length > 0))
        || !isCommitmentDestination(item.destination)
        || !isCommitmentTemporal(item.temporal)
        || !isString(item.realizationClause) || item.realizationClause.trim().length === 0
        || !isCommitmentThoughtCycle(item.thoughtCycle)) {
        return failure("malformed", "COMMITMENT_PROPOSAL_INVALID");
      }
      ordinals.add(item.ordinal);
    }
  }
  if (value.stance !== undefined) {
    if (!isRecord(value.stance)) return failure("malformed", "STANCE_INVALID");
    const stance = value.stance;
    if (
      !["low", "medium", "high"].includes(String(stance.warmth)) ||
      typeof stance.humorAllowed !== "boolean" ||
      typeof stance.disagreement !== "boolean" ||
      typeof stance.uncertaintyDisplay !== "boolean"
    ) {
      return failure("malformed", "STANCE_INVALID");
    }
  }
  return null;
}

function isCommitmentDestination(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "owner_private") return Object.keys(value).length === 1;
  if (value.kind === "owner_dm") return Object.keys(value).length === 2 && typeof value.threadId === "string" && value.threadId.trim().length > 0;
  if (value.kind === "dm") return Object.keys(value).length === 2 && isString(value.principalId) && value.principalId.trim().length > 0;
  if (value.kind === "room") return Object.keys(value).length === 2 && isString(value.roomId) && value.roomId.trim().length > 0;
  return false;
}

function isCommitmentTemporal(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "exact") return Object.keys(value).length === 2 && Number.isInteger(value.atMs);
  if (value.kind === "bounded") return Object.keys(value).length === 3
    && Number.isInteger(value.windowStartMs)
    && Number.isInteger(value.windowEndMs)
    && Number(value.windowEndMs) >= Number(value.windowStartMs);
  return value.kind === "open" && Object.keys(value).length === 1;
}

function isCommitmentThoughtCycle(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).length === 2
    && isString(value.cycleId) && value.cycleId.trim().length > 0
    && isString(value.attemptId) && value.attemptId.trim().length > 0;
}

function validateOperations(
  value: unknown,
  active?: SettlementValidationActiveIdentity,
): ThoughtSettlementValidation | null {
  if (!isRecord(value) || !isStringArray(value.observationsConsumed) || !isStringArray(value.effectsCompleted) || !isStringArray(value.intentsStillInFlight)) {
    return failure("malformed", "OPERATIONS_MISSING");
  }
  if (value.retrievalRefsUsed !== undefined && !isStringArray(value.retrievalRefsUsed)) {
    return failure("malformed", "OPERATIONS_RETRIEVAL_REFS_INVALID");
  }
  if (value.sourceRefsUsed !== undefined && !isStringArray(value.sourceRefsUsed)) {
    return failure("malformed", "OPERATIONS_SOURCE_REFS_INVALID");
  }
  const receipts = new Set([
    ...(active?.consumedEffectIds ?? []),
    ...(active?.effectReceiptIds ?? []),
  ]);
  if (receipts.size > 0 && value.effectsCompleted.some((id) => !receipts.has(id))) {
    return failure("malformed", "EFFECT_RECEIPT_REQUIRED");
  }
  return null;
}

/**
 * Code-owned validation for Thought JSON. This function never licenses speech
 * and never mutates the sidecar. A caller must still run Authority and the
 * atomic publication transaction after this check.
 */
export function validateThoughtSettlementDraft(
  draft: unknown,
  active?: SettlementValidationActiveIdentity,
): ThoughtSettlementValidation {
  if (!isRecord(draft)) return failure("malformed", "DRAFT_OBJECT_REQUIRED");
  const publishedField = containsPublishedOnlyField(draft);
  if (publishedField) return failure("malformed", `PUBLISHED_FIELD_FORBIDDEN:${publishedField}`);
  if (draft.schemaVersion !== SETTLEMENT_SCHEMA_VERSION) {
    return failure("malformed", "SCHEMA_VERSION_INVALID");
  }

  const identityFailure = validateIdentity(draft, active);
  if (identityFailure) return identityFailure;
  if (!isString(draft.triggerRef)) return failure("malformed", "TRIGGER_REF_MISSING");

  for (const key of ["speech", "operations", "authority"] as const) {
    if (!isRecord(draft[key])) return failure("malformed", `${key.toUpperCase()}_MISSING`);
  }
  if (draft.interpretation !== undefined) {
    if (!isRecord(draft.interpretation)) return failure("malformed", "INTERPRETATION_INVALID");
    const interpretation = draft.interpretation as RecordValue;
    for (const key of ["discourseActs", "referentBindings", "corrections", "unresolvedAmbiguities", "topics"] as const) {
      if (interpretation[key] !== undefined && !Array.isArray(interpretation[key])) {
        return failure("malformed", `INTERPRETATION_${key.toUpperCase()}_INVALID`);
      }
    }
  }
  for (const key of ["workingContextDelta", "concernDeltas", "occupancyDelta", "futureTriggers", "subscriptions", "durableNominations"] as const) {
    if (draft[key] !== undefined && !Array.isArray(draft[key])) return failure("malformed", `${key.toUpperCase()}_INVALID`);
  }
  const commitments = draft.commitments as RecordValue;
  const speech = draft.speech as RecordValue;
  const commitmentFailure = validateCommitments(commitments, active);
  if (commitmentFailure) return commitmentFailure;
  const speechFailure = validateSpeech(speech);
  if (speechFailure) return speechFailure;
  const operationsFailure = validateOperations(draft.operations, active);
  if (operationsFailure) return operationsFailure;
  const authority = draft.authority as RecordValue;
  const revisionCount = authority.revisionCount;
  if (!isStringArray(authority.objectionsApplied) || typeof revisionCount !== "number" || !Number.isInteger(revisionCount)) {
    return failure("malformed", "AUTHORITY_INVALID");
  }
  if (revisionCount < 0 || revisionCount > MAX_AUTHORITY_REVISIONS) {
    return failure("malformed", "REVISION_BUDGET_EXCEEDED");
  }

  return { ok: true, kind: "ok", draft: draft as unknown as ThoughtSettlementDraft };
}

export function assertValidThoughtSettlementDraft(
  draft: unknown,
  active?: SettlementValidationActiveIdentity,
): ThoughtSettlementDraft {
  const result = validateThoughtSettlementDraft(draft, active);
  if (!result.ok) throw new Error(`thought_settlement_${result.kind}:${result.error}`);
  return result.draft;
}

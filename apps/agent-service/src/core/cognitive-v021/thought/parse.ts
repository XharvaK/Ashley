import { isValidAttentionClaim } from "../thalamus/attention.js";
import type {
  AbstainSemanticOutput,
  ConcernSemanticDelta,
  DeskEntrySemantic,
  DeskSemanticDelta,
  EffectIntentSemanticOutput,
  ExistingRef,
  FutureTriggerSemanticDelta,
  JsonObject,
  JsonValue,
  LocalAlias,
  ObservationIntentSemanticOutput,
  OccupancySemanticDelta,
  SemanticRef,
  SettlementSemanticOutput,
  SubscriptionSemanticDelta,
  ThoughtCommitments,
  ThoughtDurableNomination,
  ThoughtEvidenceUse,
  ThoughtInterpretation,
  ThoughtSemanticOutput,
  ThoughtSpeechIntent,
  WorkingContextItemSemantic,
  WorkingContextSemanticDelta,
} from "../types.js";
import { isMemoryKind } from "../memory/kinds.js";
import { validateModeBRequest } from "../../sandbox/opencode/mode-b-request.js";
import { isValidForgetClaim } from "../memory/semantic-forget.js";
import {
  isEvidenceOperationKind,
  isValidEvidenceOperationRequest,
  isValidWebFetchOperationRequest,
  isValidWebSearchOperationRequest,
  isTypedInspectionOperationKind,
  isValidTypedInspectionRequest,
  isWebFetchOperationKind,
  isWebSearchOperationKind,
} from "./typed-inspection.js";
import {
  EPISTEMIC_DIMENSIONS,
  REGISTERED_OPERATION_KINDS,
  type EpistemicDimension,
  type EpistemicDimensionRepair,
} from "./output-contract.js";
import { parseSourceSupportRef, parseWorkingContextInterpretationDraft } from "../evidence/interpretation-envelope.js";
import { isConcernObjectiveFacet } from "../concerns/objective.js";
import { isInterestRoot } from "../memory/interests.js";
import { isPlaceIntentClaims } from "../../places/intents.js";
import { isHomeOps } from "../../home/home.js";
import { isOwnTimeClaim, isPursuitOps } from "../../will/pursuits.js";
import { isValidWebRequest, isWebPlaceClaims } from "../../reach/web.js";
import { isContactStop, isPlaceRuleClaims } from "../../places/rules.js";
import { isJournalActivity } from "../initiative/journal.js";
import { isDomusActClaim } from "../../domus/acts.js";
import { isValidSenseClaim } from "../senses/senses.js";
import { isValidGrowthClaim, isValidNightClaim } from "../growth/claim.js";

export type ThoughtSemanticParseFailureCode =
  | "invalid_json"
  | "root_not_object"
  | "wrong_kind"
  | "unknown_field"
  | "empty_when_present"
  | "required_field_missing"
  | "wrong_type"
  | "invalid_enum"
  | "reference_not_allowlisted"
  | "commitment_binding_invalid"
  | "alias_invalid"
  | "alias_collides_with_existing_ref"
  | "operation_not_registered";

// The parser identity is deliberately stable. Contract/schema selection is
// owned by Model Fabric (the dispatch contract), not by this implementation
// identity.
export const THOUGHT_SEMANTIC_PARSER_ID = "ashley.thought.semantic-parser.v1" as const;

export type ThoughtSemanticParseResult =
  | { ok: true; value: ThoughtSemanticOutput }
  | { ok: false; code: ThoughtSemanticParseFailureCode; field?: string; epistemicRepairs?: readonly EpistemicDimensionRepair[] };

type SemanticRecord = Record<string, unknown>;
type ValidationResult = { ok: true } | {
  ok: false;
  code: ThoughtSemanticParseFailureCode;
  field?: string;
  epistemicRepairs?: readonly EpistemicDimensionRepair[];
};

const REGISTERED_OPERATION_KIND_SET: ReadonlySet<string> = new Set(REGISTERED_OPERATION_KINDS);

const OK: ValidationResult = { ok: true };

function prefixFailure(result: ValidationResult, prefix: string): ValidationResult {
  return result.ok
    ? result
    : { ...result, field: result.field ? `${prefix}.${result.field}` : prefix };
}

function semanticRecord(value: unknown): SemanticRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as SemanticRecord
    : null;
}

function own(record: SemanticRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function optionalTypedSupportRefs(record: SemanticRecord): boolean {
  return !own(record, "supportRefs")
    || (Array.isArray(record.supportRefs) && record.supportRefs.every((ref) => parseSourceSupportRef(ref) !== null));
}

function failure(code: ThoughtSemanticParseFailureCode, field?: string): ValidationResult {
  return { ok: false, code, ...(field ? { field } : {}) };
}

function recordShape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): SemanticRecord | null {
  const record = semanticRecord(value);
  if (!record) return null;
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (required.some((key) => !own(record, key))) return null;
  return record;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  const record = semanticRecord(value);
  return record !== null && Object.values(record).every(jsonValue);
}

function jsonObject(value: unknown): value is JsonObject {
  return semanticRecord(value) !== null && jsonValue(value);
}

function validProjectInspectionObjective(value: unknown): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.projectId !== "string" || record.projectId.length === 0) return false;
  if (record.operation === undefined) {
    const allowed = new Set(["projectId", "locator", "question", "focus", "maxSteps"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return false;
    if (record.question !== undefined && !nonEmptyString(record.question)) return false;
    if (record.focus !== undefined && !nonEmptyString(record.focus)) return false;
    if (record.maxSteps !== undefined && (
      typeof record.maxSteps !== "number" || !Number.isSafeInteger(record.maxSteps) || record.maxSteps < 1
    )) return false;
    if (record.locator === undefined) return true;
    const locator = semanticRecord(record.locator);
    if (!locator || typeof locator.kind !== "string") return false;
    if (locator.kind === "file" || locator.kind === "directory") {
      return recordShape(locator, ["kind", "path"]) !== null && nonEmptyString(locator.path);
    }
    if (locator.kind !== "search") return false;
    return recordShape(locator, ["kind", "pattern"], ["path", "maxMatches"]) !== null
      && nonEmptyString(locator.pattern)
      && (locator.path === undefined || nonEmptyString(locator.path))
      && (locator.maxMatches === undefined || (
        typeof locator.maxMatches === "number" && Number.isSafeInteger(locator.maxMatches) && locator.maxMatches > 0
      ));
  }
  // The route-neutral semantic contract never carries a Host primitive.
  return false;
}

function existingRef(value: unknown, allowlist: ReadonlySet<string>): value is ExistingRef {
  return nonEmptyString(value) && allowlist.has(value);
}

function localAlias(value: unknown): value is LocalAlias {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value);
}

function semanticRef(value: unknown, allowlist: ReadonlySet<string>): value is SemanticRef {
  const record = semanticRecord(value);
  if (!record || Object.keys(record).length !== 2 || record.kind === undefined) return false;
  if (record.kind === "existing") return own(record, "ref") && existingRef(record.ref, allowlist);
  if (record.kind === "local") return own(record, "alias") && localAlias(record.alias);
  return false;
}

function refArray(value: unknown, allowlist: ReadonlySet<string>, allowEmpty = true): value is ExistingRef[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => existingRef(item, allowlist));
}

function optionalArray(
  record: SemanticRecord,
  key: string,
  itemValidator: (item: unknown) => boolean,
  nonEmpty = true,
): ValidationResult {
  if (!own(record, key)) return OK;
  if (!Array.isArray(record[key])) return failure("wrong_type", key);
  if (nonEmpty && record[key].length === 0) return failure("empty_when_present", key);
  if (!record[key].every(itemValidator)) return failure("wrong_type", key);
  return OK;
}

function optionalObject(
  parent: SemanticRecord,
  key: string,
  allowed: readonly string[],
): { record: SemanticRecord } | { failure: ValidationResult } | null {
  if (!own(parent, key)) return null;
  const value = parent[key];
  const child = semanticRecord(value);
  if (!child) return { failure: failure("wrong_type", key) };
  const unknown = Object.keys(child).find((childKey) => !allowed.includes(childKey));
  if (unknown) return { failure: failure("unknown_field", `${key}.${unknown}`) };
  if (Object.keys(child).length === 0) return { failure: failure("empty_when_present", key) };
  return { record: child };
}

function epistemicDimensionRepairs(value: unknown, field: string): EpistemicDimensionRepair[] {
  const record = recordShape(value, ["source", "status", "time", "reliability"]);
  if (!record) return [];
  const repairs: EpistemicDimensionRepair[] = [];
  for (const dimension of Object.keys(EPISTEMIC_DIMENSIONS) as EpistemicDimension[]) {
    const value = record[dimension];
    const definition = EPISTEMIC_DIMENSIONS[dimension];
    if (typeof value === "string" && !Object.prototype.hasOwnProperty.call(definition.values, value)) {
      repairs.push({ path: `${field}.${dimension}`, value, dimension });
    }
  }
  return repairs;
}

function validEpistemicDimensions(value: unknown): boolean {
  const record = recordShape(value, ["source", "status", "time", "reliability"]);
  return !!record && (Object.keys(EPISTEMIC_DIMENSIONS) as EpistemicDimension[]).every((dimension) => {
    const item = record[dimension];
    return typeof item === "string" &&
      Object.prototype.hasOwnProperty.call(EPISTEMIC_DIMENSIONS[dimension].values, item);
  });
}

function validSemanticRefField(value: unknown, allowlist: ReadonlySet<string>): boolean {
  return value === null || semanticRef(value, allowlist);
}

function validEpistemicObservationRefs(
  value: unknown,
  allowlist: ReadonlySet<string>,
  field: string,
): ValidationResult {
  if (!Array.isArray(value)) return failure("wrong_type", field);
  if (value.length === 0) return failure("empty_when_present", field);
  for (const [index, item] of value.entries()) {
    if (!nonEmptyString(item)) return failure("wrong_type", `${field}[${index}]`);
    if (!allowlist.has(item)) return failure("reference_not_allowlisted", `${field}[${index}]`);
  }
  return OK;
}

function validEpistemicCommitment(
  value: unknown,
  allowlist: ReadonlySet<string>,
  field: string,
): ValidationResult {
  const record = recordShape(value, ["dimensions", "statement"], ["surfaceSpan", "observationRefs"]);
  if (!record || !nonEmptyString(record.statement)) {
    return failure("wrong_type", field);
  }
  const dimensionRepairs = epistemicDimensionRepairs(record.dimensions, `${field}.dimensions`);
  if (dimensionRepairs.length > 0) {
    return {
      ok: false,
      code: "invalid_enum",
      field: dimensionRepairs[0].path,
      epistemicRepairs: dimensionRepairs,
    };
  }
  if (!validEpistemicDimensions(record.dimensions)) return failure("wrong_type", field);
  if (record.surfaceSpan !== undefined && !nonEmptyString(record.surfaceSpan)) {
    return failure("wrong_type", `${field}.surfaceSpan`);
  }
  if (record.observationRefs !== undefined) {
    const refs = validEpistemicObservationRefs(record.observationRefs, allowlist, `${field}.observationRefs`);
    if (!refs.ok) return refs;
  }
  const dimensions = semanticRecord(record.dimensions);
  const external = dimensions?.source === "tool" || dimensions?.source === "perception";
  const hasSurfaceSpan = record.surfaceSpan !== undefined;
  const hasObservationRefs = record.observationRefs !== undefined;
  if (external && hasSurfaceSpan !== hasObservationRefs) {
    return failure(
      "commitment_binding_invalid",
      hasSurfaceSpan ? `${field}.observationRefs` : `${field}.surfaceSpan`,
    );
  }
  return OK;
}

function validReferentBinding(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["span", "sourceTurnRefs"], ["concernRef", "entityRef"]);
  return !!record
    && nonEmptyString(record.span)
    && refArray(record.sourceTurnRefs, allowlist)
    && (record.concernRef === undefined || existingRef(record.concernRef, allowlist))
    && (record.entityRef === undefined || existingRef(record.entityRef, allowlist));
}

function validCorrection(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["correctedTurnRefs", "fromSpan", "toSpan"], ["concernRef"]);
  return !!record
    && refArray(record.correctedTurnRefs, allowlist)
    && nonEmptyString(record.fromSpan)
    && nonEmptyString(record.toSpan)
    && (record.concernRef === undefined || existingRef(record.concernRef, allowlist));
}

function validateInterpretation(parent: SemanticRecord, allowlist: ReadonlySet<string>): ValidationResult {
  const optional = optionalObject(parent, "interpretation", [
    "discourseActs", "referentBindings", "corrections", "unresolvedAmbiguities", "topics",
  ]);
  if (!optional) return OK;
  if ("failure" in optional) return optional.failure;
  const record = optional.record;
  const acts = ["inform", "ask", "correct", "acknowledge", "disagree", "hold", "silence", "other"];
  let result = prefixFailure(optionalArray(record, "discourseActs", (item) => typeof item === "string" && acts.includes(item)), "interpretation");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "referentBindings", (item) => validReferentBinding(item, allowlist)), "interpretation");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "corrections", (item) => validCorrection(item, allowlist)), "interpretation");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "unresolvedAmbiguities", nonEmptyString), "interpretation");
  if (!result.ok) return result;
  return prefixFailure(optionalArray(record, "topics", nonEmptyString), "interpretation");
}

function validOperationalClaim(value: unknown): boolean {
  const record = recordShape(value, ["effectRef", "claimedState"]);
  return !!record && nonEmptyString(record.effectRef)
    && ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"].includes(record.claimedState as string);
}

function validStance(value: unknown): boolean {
  const stance = recordShape(value, ["warmth", "humorAllowed", "disagreement", "uncertaintyDisplay"]);
  return !!stance
    && ["low", "medium", "high"].includes(stance.warmth as string)
    && typeof stance.humorAllowed === "boolean"
    && typeof stance.disagreement === "boolean"
    && typeof stance.uncertaintyDisplay === "boolean";
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function validCommitmentDestination(value: unknown): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.kind !== "string") return false;
  if (record.kind === "owner_private") return Object.keys(record).length === 1;
  if (record.kind === "owner_dm") return Object.keys(record).length === 2 && nonEmptyString(record.threadId);
  if (record.kind === "dm") return Object.keys(record).length === 2 && nonEmptyString(record.principalId);
  if (record.kind === "room") return Object.keys(record).length === 2 && nonEmptyString(record.roomId);
  return false;
}

function validCommitmentTemporal(value: unknown): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.kind !== "string") return false;
  if (record.kind === "exact") return Object.keys(record).length === 2 && integer(record.atMs);
  if (record.kind === "bounded") {
    return Object.keys(record).length === 3
      && integer(record.windowStartMs)
      && integer(record.windowEndMs)
      && record.windowEndMs >= record.windowStartMs;
  }
  return record.kind === "open" && Object.keys(record).length === 1;
}

function validCommitmentProposal(value: unknown): boolean {
  const record = recordShape(value, [
    "ordinal", "action", "beneficiary", "destination", "temporal", "realizationClause", "thoughtCycle",
  ], ["timezoneId", "requiredPrecisionMs", "lateBehavior", "latestUsefulAtMs"]);
  const thoughtCycle = record ? semanticRecord(record.thoughtCycle) : null;
  return !!record
    && integer(record.ordinal) && record.ordinal >= 0 && record.ordinal <= 7
    && nonEmptyString(record.action)
    && (record.beneficiary === "owner" || nonEmptyString(record.beneficiary))
    && validCommitmentDestination(record.destination)
    && validCommitmentTemporal(record.temporal)
    && nonEmptyString(record.realizationClause)
    && !!thoughtCycle
    && Object.keys(thoughtCycle).length === 2
    && nonEmptyString(thoughtCycle.cycleId)
    && nonEmptyString(thoughtCycle.attemptId)
    && (record.timezoneId === undefined || nonEmptyString(record.timezoneId))
    && (record.requiredPrecisionMs === undefined || (integer(record.requiredPrecisionMs) && record.requiredPrecisionMs > 0))
    && (record.lateBehavior === undefined || ["deliver_late", "reconsider", "expire"].includes(String(record.lateBehavior)))
    && (record.latestUsefulAtMs === undefined || record.latestUsefulAtMs === null
      || (integer(record.latestUsefulAtMs) && record.latestUsefulAtMs >= 0));
}

function validateCommitments(parent: SemanticRecord, allowlist: ReadonlySet<string>): ValidationResult {
  const optional = optionalObject(parent, "commitments", ["epistemic", "operational", "conversational", "commitmentProposals", "stance"]);
  if (!optional) return OK;
  if ("failure" in optional) return optional.failure;
  const record = optional.record;
  const conversational = ["answer", "ask", "acknowledge", "disagree", "hold", "silence"];
  if (own(record, "epistemic")) {
    if (!Array.isArray(record.epistemic)) return failure("wrong_type", "commitments.epistemic");
    if (record.epistemic.length === 0) return failure("empty_when_present", "commitments.epistemic");
    const epistemicRepairs: EpistemicDimensionRepair[] = [];
    for (const [index, item] of (record.epistemic as unknown[]).entries()) {
      const result = validEpistemicCommitment(item, allowlist, `commitments.epistemic[${index}]`);
      if (!result.ok) {
        if (result.code === "invalid_enum" && result.epistemicRepairs) {
          epistemicRepairs.push(...result.epistemicRepairs);
          continue;
        }
        return result;
      }
    }
    if (epistemicRepairs.length > 0) return {
      ok: false,
      code: "invalid_enum",
      field: epistemicRepairs[0].path,
      epistemicRepairs,
    };
  }
  let result = prefixFailure(optionalArray(record, "operational", validOperationalClaim), "commitments");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "conversational", (item) => typeof item === "string" && conversational.includes(item)), "commitments");
  if (!result.ok) return result;
  if (own(record, "commitmentProposals")) {
    if (!Array.isArray(record.commitmentProposals)) return failure("wrong_type", "commitments.commitmentProposals");
    if (record.commitmentProposals.length === 0) return failure("empty_when_present", "commitments.commitmentProposals");
    if (record.commitmentProposals.length > 8) return failure("wrong_type", "commitments.commitmentProposals");
    const ordinals = new Set<number>();
    for (const [index, item] of (record.commitmentProposals as unknown[]).entries()) {
      if (!validCommitmentProposal(item)) return failure("wrong_type", `commitments.commitmentProposals[${index}]`);
      const ordinal = (item as { ordinal: number }).ordinal;
      if (ordinals.has(ordinal)) return failure("commitment_binding_invalid", `commitments.commitmentProposals[${index}].ordinal`);
      ordinals.add(ordinal);
    }
  }
  if (own(record, "stance") && !validStance(record.stance)) return failure("wrong_type", "commitments.stance");
  return OK;
}

/**
 * Structural bound for the cognition-owned optional-initiative signal.
 * Short Thought-authored why only; absence means no expressed preference.
 */
export const INITIATIVE_PREFERENCE_REASON_MAX_LENGTH = 280;

function validateInitiativePreference(value: unknown): ValidationResult {
  const record = semanticRecord(value);
  if (!record) return failure("wrong_type", "initiativePreference");
  const unknown = Object.keys(record).find((key) => ![
    "stance", "reason",
  ].includes(key));
  if (unknown) return failure("unknown_field", `initiativePreference.${unknown}`);
  if (!own(record, "stance")) return failure("required_field_missing", "initiativePreference.stance");
  if (record.stance !== "willing" && record.stance !== "strong") return failure("invalid_enum", "initiativePreference.stance");
  if (!own(record, "reason")) return failure("required_field_missing", "initiativePreference.reason");
  if (!nonEmptyString(record.reason)) return failure("wrong_type", "initiativePreference.reason");
  if (record.reason.length > INITIATIVE_PREFERENCE_REASON_MAX_LENGTH) {
    return failure("wrong_type", "initiativePreference.reason");
  }
  return OK;
}

function validateSpeech(value: unknown): ValidationResult {
  const record = semanticRecord(value);
  if (!record) return failure("wrong_type", "speech");
  const unknown = Object.keys(record).find((key) => ![
    "mode", "surfaceDraft", "mustSay", "mustNotSay", "presentationDirectives",
  ].includes(key));
  if (unknown) return failure("unknown_field", `speech.${unknown}`);
  if (!own(record, "mode")) return failure("required_field_missing", "speech.mode");
  if (record.mode !== "none" && record.mode !== "draft") return failure("invalid_enum", "speech.mode");
  if (record.mode === "none") {
    return Object.keys(record).length === 1
      ? OK
      : failure("unknown_field", `speech.${Object.keys(record).find((key) => key !== "mode") ?? "field"}`);
  }
  if (!own(record, "surfaceDraft")) return failure("required_field_missing", "speech.surfaceDraft");
  if (!nonEmptyString(record.surfaceDraft)) return failure("wrong_type", "speech.surfaceDraft");
  let result = prefixFailure(optionalArray(record, "mustSay", nonEmptyString), "speech");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "mustNotSay", nonEmptyString), "speech");
  if (!result.ok) return result;
  return prefixFailure(optionalArray(record, "presentationDirectives", nonEmptyString), "speech");
}

/**
 * Structural bound for a detached-operation interim hold draft. Short
 * acknowledgement/intent text only; the wire schema carries the same bound
 * for provider-side enforcement.
 */
export const INTERIM_SURFACE_DRAFT_MAX_LENGTH = 600;

function validateInterimSpeech(value: unknown): ValidationResult {
  const record = semanticRecord(value);
  if (!record) return failure("wrong_type", "interimSpeech");
  const unknown = Object.keys(record).find((key) => ![
    "mode", "surfaceDraft", "presentationDirectives",
  ].includes(key));
  if (unknown) return failure("unknown_field", `interimSpeech.${unknown}`);
  if (!own(record, "mode")) return failure("required_field_missing", "interimSpeech.mode");
  if (record.mode !== "none" && record.mode !== "hold") return failure("invalid_enum", "interimSpeech.mode");
  if (record.mode === "none") {
    return Object.keys(record).length === 1
      ? OK
      : failure("unknown_field", `interimSpeech.${Object.keys(record).find((key) => key !== "mode") ?? "field"}`);
  }
  if (!own(record, "surfaceDraft")) return failure("required_field_missing", "interimSpeech.surfaceDraft");
  if (!nonEmptyString(record.surfaceDraft)) return failure("wrong_type", "interimSpeech.surfaceDraft");
  if (record.surfaceDraft.length > INTERIM_SURFACE_DRAFT_MAX_LENGTH) {
    return failure("wrong_type", "interimSpeech.surfaceDraft");
  }
  return prefixFailure(optionalArray(record, "presentationDirectives", nonEmptyString), "interimSpeech");
}

function validWorkingContextItem(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["identity", "type", "text", "concernRef", "sourceTurnRefs", "status", "supersedesRef"], ["interpretationEnvelope"]);
  const types = ["topic", "referent", "correction", "owner_teaching", "question", "commitment_temp", "repair"];
  const statuses = ["active", "superseded", "abandoned"];
  return !!record && semanticRef(record.identity, allowlist) && types.includes(record.type as string)
    && nonEmptyString(record.text) && validSemanticRefField(record.concernRef, allowlist)
    && refArray(record.sourceTurnRefs, allowlist) && statuses.includes(record.status as string)
    && validSemanticRefField(record.supersedesRef, allowlist)
    && (!own(record, "interpretationEnvelope") || parseWorkingContextInterpretationDraft(record.interpretationEnvelope) !== null);
}

function validWorkingContextDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "upsert") return Object.keys(record).length === 2 && validWorkingContextItem(record.item, allowlist);
  if (record.op === "abandon") return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  if (record.op === "supersede") return Object.keys(record).length === 3 && existingRef(record.target, allowlist)
    && validWorkingContextItem(record.replacement, allowlist);
  return false;
}

function validDeskEntry(value: unknown, allowlist: ReadonlySet<string>): value is DeskEntrySemantic {
  const record = recordShape(value, [
    "identity", "concernRef", "body", "authorKind", "sourceRefs", "verbatim", "form", "endorsementRef", "audienceScope",
  ], ["supportRefs"]);
  if (!record || !semanticRef(record.identity, allowlist) || !validSemanticRefField(record.concernRef, allowlist)
    || !nonEmptyString(record.body) || !refArray(record.sourceRefs, allowlist) || !optionalTypedSupportRefs(record)
    || typeof record.verbatim !== "boolean" || !validCommitmentDestination(record.audienceScope)) return false;
  const authorKind = record.authorKind;
  const form = record.form;
  if (authorKind !== "ashley" && authorKind !== "owner" && authorKind !== "quoted_external") return false;
  if (form !== "note" && form !== "draft" && form !== "observation" && form !== "brainstorm") return false;
  if (authorKind === "quoted_external" ? record.verbatim !== true : record.verbatim !== false) return false;
  return record.endorsementRef === null || existingRef(record.endorsementRef, allowlist);
}

function validDeskDelta(value: unknown, allowlist: ReadonlySet<string>): value is DeskSemanticDelta {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "upsert") return Object.keys(record).length === 2 && validDeskEntry(record.entry, allowlist);
  if (record.op === "supersede") return Object.keys(record).length === 3
    && existingRef(record.target, allowlist) && validDeskEntry(record.replacement, allowlist);
  if (record.op === "archive" || record.op === "tombstone") {
    return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  }
  return false;
}

function validConcernDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "resolve") return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  if (record.op !== "upsert" || Object.keys(record).length !== 2) return false;
  const item = recordShape(record.record, ["identity", "statement", "sourceTurnRefs", "dimensions", "status"], ["supportRefs", "objective"]);
  return !!item && semanticRef(item.identity, allowlist) && nonEmptyString(item.statement)
    && refArray(item.sourceTurnRefs, allowlist) && optionalTypedSupportRefs(item)
    && (!own(item, "objective") || isConcernObjectiveFacet(item.objective))
    && validEpistemicDimensions(item.dimensions)
    && ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved"].includes(item.status as string);
}

function validOccupancyDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["op", "concernRef", "status", "priority"]);
  return !!record && record.op === "set" && semanticRef(record.concernRef, allowlist)
    && ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved"].includes(record.status as string)
    && typeof record.priority === "number" && Number.isInteger(record.priority);
}

function validFutureTriggerDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "cancel") return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  const item = recordShape(record, ["op", "concernRef", "dueAtMs", "purpose", "payload"]);
  return !!item && item.op === "create" && semanticRef(item.concernRef, allowlist)
    && typeof item.dueAtMs === "number" && Number.isInteger(item.dueAtMs)
    && nonEmptyString(item.purpose) && jsonObject(item.payload);
}

function validSubscriptionDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "cancel") return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  const item = recordShape(record, ["op", "subscription"]);
  const subscription = item && recordShape(item.subscription, ["concernRef", "source", "scope", "topicKeys", "match", "expiresAtMs"], ["externalSource", "pollIntervalMs"]);
  if (!item || !subscription || item.op !== "create") return false;
  const external = subscription.externalSource === undefined
    ? null
    : recordShape(subscription.externalSource, ["kind", "urlPattern"]);
  const externalValid = subscription.externalSource === undefined
    ? subscription.pollIntervalMs === undefined
    : !!external
      && (external.kind === "url" || external.kind === "url_pattern" || external.kind === "rss" || external.kind === "atom" || external.kind === "json")
      && nonEmptyString(external.urlPattern)
      && subscription.pollIntervalMs !== undefined
      && typeof subscription.pollIntervalMs === "number"
      && Number.isSafeInteger(subscription.pollIntervalMs)
      && subscription.pollIntervalMs > 0
      && subscription.expiresAtMs !== null;
  return externalValid
    && validSemanticRefField(subscription.concernRef, allowlist)
    && nonEmptyString(subscription.source) && nonEmptyString(subscription.scope)
    && stringArray(subscription.topicKeys)
    && (subscription.match === "equality" || subscription.match === "substring")
    && (subscription.expiresAtMs === null || (typeof subscription.expiresAtMs === "number" && Number.isInteger(subscription.expiresAtMs)));
}

const NOMINATION_REQUIRED = ["statement", "memoryKind", "dimensions", "dataClassification", "sourceRefs", "supersedesRef", "concernRef"] as const;
const NOMINATION_OPTIONAL = ["supportRefs", "salience"] as const;

/** The first part of a nomination that is wrong (a contract field name, never her words), or null. */
function nominationFault(value: unknown, allowlist: ReadonlySet<string>): string | null {
  const record = semanticRecord(value);
  if (!record) return "not_object";
  const allowed = new Set<string>([...NOMINATION_REQUIRED, ...NOMINATION_OPTIONAL]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown !== undefined) return "unknown_key";
  const missing = NOMINATION_REQUIRED.find((key) => !own(record, key));
  if (missing !== undefined) return missing;
  if (!nonEmptyString(record.statement)) return "statement";
  if (!isMemoryKind(record.memoryKind)) return "memoryKind";
  if (own(record, "salience") && !(typeof record.salience === "number" && record.salience >= 0 && record.salience <= 1)) return "salience";
  if (!validEpistemicDimensions(record.dimensions)) return "dimensions";
  if (!["ordinary", "sensitive", "never_public", "secret"].includes(record.dataClassification as string)) return "dataClassification";
  if (!refArray(record.sourceRefs, allowlist)) return "sourceRefs";
  if (!optionalTypedSupportRefs(record)) return "supportRefs";
  if (!(record.supersedesRef === null || existingRef(record.supersedesRef, allowlist))) return "supersedesRef";
  if (!validSemanticRefField(record.concernRef, allowlist)) return "concernRef";
  return null;
}

function validNomination(value: unknown, allowlist: ReadonlySet<string>): value is ThoughtDurableNomination {
  return nominationFault(value, allowlist) === null;
}

function validateEvidenceUse(parent: SemanticRecord, allowlist: ReadonlySet<string>): ValidationResult {
  const optional = optionalObject(parent, "evidenceUse", [
    "observationRefsUsed", "retrievalRefsUsed", "sourceRefsUsed", "openIntentRefs",
  ]);
  if (!optional) return OK;
  if ("failure" in optional) return optional.failure;
  const record = optional.record;
  const check = (key: string) => prefixFailure(optionalArray(record, key, (item) => existingRef(item, allowlist)), "evidenceUse");
  let result = check("observationRefsUsed");
  if (!result.ok) return result;
  result = check("retrievalRefsUsed");
  if (!result.ok) return result;
  result = check("sourceRefsUsed");
  if (!result.ok) return result;
  return check("openIntentRefs");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + 1;
  }
}

/**
 * Cross-field claim binding: every per-claim observation ref must also be
 * declared in settlement-level evidenceUse, and every authored surfaceSpan
 * must occur exactly once in Thought's own surfaceDraft with all bound spans
 * pairwise non-overlapping. Semantic correspondence between statement and
 * span is Thought's authorship and is never judged here.
 */
function validateCommitmentBindings(record: SemanticRecord): ValidationResult {
  const commitments = semanticRecord(record.commitments);
  const epistemic: unknown[] = commitments && Array.isArray(commitments.epistemic)
    ? commitments.epistemic
    : [];
  const evidenceUse = semanticRecord(record.evidenceUse);
  const declared = new Set(
    evidenceUse && Array.isArray(evidenceUse.observationRefsUsed)
      ? (evidenceUse.observationRefsUsed as unknown[]).filter((ref): ref is string => typeof ref === "string")
      : [],
  );
  const speech = semanticRecord(record.speech);
  const draft = speech && speech.mode === "draft" && typeof speech.surfaceDraft === "string"
    ? speech.surfaceDraft
    : null;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const [index, item] of epistemic.entries()) {
    const itemRecord = semanticRecord(item);
    if (!itemRecord) continue;
    const base = `commitments.epistemic[${index}]`;
    if (Array.isArray(itemRecord.observationRefs)) {
      for (const [refIndex, ref] of (itemRecord.observationRefs as unknown[]).entries()) {
        if (typeof ref === "string" && !declared.has(ref)) {
          return failure("commitment_binding_invalid", `${base}.observationRefs[${refIndex}]`);
        }
      }
    }
    if (typeof itemRecord.surfaceSpan === "string") {
      const span = itemRecord.surfaceSpan;
      if (draft === null || countOccurrences(draft, span) !== 1) {
        return failure("commitment_binding_invalid", `${base}.surfaceSpan`);
      }
      const start = draft.indexOf(span);
      const end = start + span.length;
      for (const existing of ranges) {
        if (start < existing.end && existing.start < end) {
          return failure("commitment_binding_invalid", `${base}.surfaceSpan`);
        }
      }
      ranges.push({ start, end });
    }
  }
  return OK;
}

function parseSemanticJson(raw: string | unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function semanticFailure(
  code: ThoughtSemanticParseFailureCode,
  field?: string,
  epistemicRepairs?: readonly EpistemicDimensionRepair[],
): ThoughtSemanticParseResult {
  return {
    ok: false,
    code,
    ...(field ? { field } : {}),
    ...(epistemicRepairs ? { epistemicRepairs } : {}),
  };
}

function validateSettlementLocalAliases(
  record: SemanticRecord,
  allowlist: ReadonlySet<string>,
): ValidationResult {
  const checkReference = (value: unknown, field: string): ValidationResult => {
    const ref = semanticRecord(value);
    if (!ref || ref.kind !== "local") return OK;
    if (!localAlias(ref.alias)) return failure("alias_invalid", field);
    if (allowlist.has(ref.alias)) return failure("alias_collides_with_existing_ref", field);
    return OK;
  };
  const check = (value: unknown, field: string): ValidationResult => checkReference(value, field);
  const working = Array.isArray(record.workingContextDeltas) ? record.workingContextDeltas : [];
  const desk = Array.isArray(record.deskDeltas) ? record.deskDeltas : [];
  const concerns = Array.isArray(record.concernDeltas) ? record.concernDeltas : [];
  const interpretation = semanticRecord(record.interpretation);
  for (const binding of (interpretation && Array.isArray(interpretation.referentBindings)
    ? interpretation.referentBindings : [])) {
    const bindingRecord = semanticRecord(binding);
    for (const [key, value] of [["concernRef", bindingRecord?.concernRef], ["entityRef", bindingRecord?.entityRef]] as const) {
      const result = check(value, `interpretation.${key}`);
      if (!result.ok) return result;
    }
  }
  for (const correction of (interpretation && Array.isArray(interpretation.corrections)
    ? interpretation.corrections : [])) {
    const result = check(semanticRecord(correction)?.concernRef, "interpretation.concernRef");
    if (!result.ok) return result;
  }
  for (const delta of working) {
    const deltaRecord = semanticRecord(delta);
    const item = deltaRecord?.item ?? deltaRecord?.replacement;
    const itemRecord = semanticRecord(item);
    for (const [key, value] of [["identity", itemRecord?.identity], ["concernRef", itemRecord?.concernRef], ["supersedesRef", itemRecord?.supersedesRef]] as const) {
      const result = check(value, `workingContextDeltas.${key}`);
      if (!result.ok) return result;
    }
  }
  for (const delta of desk) {
    const deltaRecord = semanticRecord(delta);
    const item = deltaRecord?.entry ?? deltaRecord?.replacement;
    const itemRecord = semanticRecord(item);
    for (const [key, value] of [["identity", itemRecord?.identity], ["concernRef", itemRecord?.concernRef]] as const) {
      const result = check(value, `deskDeltas.${key}`);
      if (!result.ok) return result;
    }
  }
  for (const delta of concerns) {
    const result = check(semanticRecord(semanticRecord(delta)?.record)?.identity, "concernDeltas.identity");
    if (!result.ok) return result;
  }
  const occupancy = Array.isArray(record.occupancyDeltas) ? record.occupancyDeltas : [];
  for (const delta of occupancy) {
    const result = check(semanticRecord(delta)?.concernRef, "occupancyDeltas.concernRef");
    if (!result.ok) return result;
  }
  const future = Array.isArray(record.futureTriggerDeltas) ? record.futureTriggerDeltas : [];
  for (const delta of future) {
    const result = check(semanticRecord(delta)?.concernRef, "futureTriggerDeltas.concernRef");
    if (!result.ok) return result;
  }
  const subscriptions = Array.isArray(record.subscriptionDeltas) ? record.subscriptionDeltas : [];
  for (const delta of subscriptions) {
    const result = check(semanticRecord(semanticRecord(delta)?.subscription)?.concernRef, "subscriptionDeltas.concernRef");
    if (!result.ok) return result;
  }
  const nominations = Array.isArray(record.durableNominations) ? record.durableNominations : [];
  for (const nomination of nominations) {
    const result = check(semanticRecord(nomination)?.concernRef, "durableNominations.concernRef");
    if (!result.ok) return result;
  }
  return OK;
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/** Growth V1 afterglow reflection: an episode and/or a rewritten thread story. */
function validReflection(value: unknown): boolean {
  const reflection = semanticRecord(value);
  if (!reflection) return false;
  const keys = Object.keys(reflection);
  if (keys.length === 0 || keys.some((key) => key !== "episode" && key !== "threadStory")) return false;
  if (own(reflection, "threadStory") && !boundedText(reflection.threadStory, 6000)) return false;
  if (!own(reflection, "episode")) return true;
  const episode = semanticRecord(reflection.episode);
  if (!episode) return false;
  if (Object.keys(episode).some((key) => !["summary", "salience", "tone", "unresolvedThreads", "takeaway"].includes(key))) return false;
  if (!boundedText(episode.summary, 1200)) return false;
  if (typeof episode.salience !== "number" || !Number.isFinite(episode.salience) || episode.salience < 0 || episode.salience > 1) return false;
  if (own(episode, "tone") && !boundedText(episode.tone, 80)) return false;
  if (own(episode, "takeaway") && !boundedText(episode.takeaway, 600)) return false;
  if (own(episode, "unresolvedThreads")) {
    const threads = episode.unresolvedThreads;
    if (!Array.isArray(threads) || threads.length === 0 || threads.length > 8) return false;
    if (!threads.every((thread) => boundedText(thread, 200))) return false;
  }
  return true;
}

/** Growth V1 journal: what Ashley mainly did in a private pass, in her own words. */
function validJournal(value: unknown): boolean {
  const journal = semanticRecord(value);
  if (!journal) return false;
  if (Object.keys(journal).some((key) => key !== "activity" && key !== "entry")) return false;
  return isJournalActivity(journal.activity) && boundedText(journal.entry, 1000);
}

/** Growth V1 interests: the roots and branches Ashley lived. */
function validInterests(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return false;
  return value.every((item) => {
    const touch = semanticRecord(item);
    if (!touch) return false;
    if (Object.keys(touch).some((key) => !["root", "branch", "note"].includes(key))) return false;
    if (!isInterestRoot(touch.root) || !boundedText(touch.branch, 80)) return false;
    return !own(touch, "note") || boundedText(touch.note, 300);
  });
}

function parseSettlementSemantic(value: SemanticRecord, allowlist: ReadonlySet<string>): ThoughtSemanticParseResult {
  const unknown = Object.keys(value).find((key) => ![
    "kind", "interactionIntent", "speech", "initiativePreference", "interpretation", "commitments", "workingContextDeltas", "deskDeltas", "concernDeltas",
    "occupancyDeltas", "futureTriggerDeltas", "subscriptionDeltas", "durableNominations", "reflection", "journal", "domusAct", "intents", "home", "pursuits", "nextOwnTime", "webPlaces", "placeRules", "contactStop", "interests", "growth", "senses", "attention", "night", "forget", "evidenceUse",
  ].includes(key));
  if (unknown) return semanticFailure("unknown_field", unknown);
  if (value.kind !== "settlement") return semanticFailure("wrong_kind", "kind");
  if (own(value, "interactionIntent") && value.interactionIntent !== "continue" && value.interactionIntent !== "initiate") {
    return semanticFailure("invalid_enum", "interactionIntent");
  }
  if (!own(value, "speech")) return semanticFailure("required_field_missing", "speech");

  let result = validateSpeech(value.speech);
  if (!result.ok) return semanticFailure(result.code, result.field, result.epistemicRepairs);
  if (own(value, "initiativePreference")) {
    // A positive optional-initiative signal attaches only to an authored
    // initiative draft. speech.mode:none keeps its canonical meaning.
    const speech = semanticRecord(value.speech);
    if (!speech || speech.mode !== "draft") {
      return semanticFailure("wrong_type", "initiativePreference");
    }
    if (value.interactionIntent !== "initiate") {
      return semanticFailure("wrong_type", "initiativePreference");
    }
    result = validateInitiativePreference(value.initiativePreference);
    if (!result.ok) return semanticFailure(result.code, result.field);
  }
  result = validateInterpretation(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field);
  result = validateCommitments(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field, result.epistemicRepairs);

  const arrays: Array<[string, (item: unknown) => boolean]> = [
    ["workingContextDeltas", (item) => validWorkingContextDelta(item, allowlist)],
    ["deskDeltas", (item) => validDeskDelta(item, allowlist)],
    ["concernDeltas", (item) => validConcernDelta(item, allowlist)],
    ["occupancyDeltas", (item) => validOccupancyDelta(item, allowlist)],
    ["futureTriggerDeltas", (item) => validFutureTriggerDelta(item, allowlist)],
    ["subscriptionDeltas", (item) => validSubscriptionDelta(item, allowlist)],
    ["durableNominations", (item) => validNomination(item, allowlist)],
  ];
  for (const [key, validator] of arrays) {
    result = optionalArray(value, key, validator, key !== "durableNominations");
    if (!result.ok && key === "durableNominations" && result.code === "wrong_type" && Array.isArray(value.durableNominations)) {
      // Name the entry and the part that is wrong, so a structural retry can fix it.
      const index = value.durableNominations.findIndex((item) => nominationFault(item, allowlist) !== null);
      if (index >= 0) {
        return semanticFailure("wrong_type", `durableNominations[${index}].${nominationFault(value.durableNominations[index], allowlist)}`);
      }
    }
    if (!result.ok) return semanticFailure(result.code, result.field);
  }
  if (own(value, "reflection") && !validReflection(value.reflection)) {
    return semanticFailure("wrong_type", "reflection");
  }
  if (own(value, "journal") && !validJournal(value.journal)) {
    return semanticFailure("wrong_type", "journal");
  }
  if (own(value, "domusAct") && !isDomusActClaim(value.domusAct)) {
    return semanticFailure("wrong_type", "domusAct");
  }
  if (own(value, "intents") && !isPlaceIntentClaims(value.intents)) {
    return semanticFailure("wrong_type", "intents");
  }
  if (own(value, "home") && !isHomeOps(value.home)) {
    return semanticFailure("wrong_type", "home");
  }
  if (own(value, "pursuits") && !isPursuitOps(value.pursuits)) {
    return semanticFailure("wrong_type", "pursuits");
  }
  if (own(value, "nextOwnTime") && !isOwnTimeClaim(value.nextOwnTime)) {
    return semanticFailure("wrong_type", "nextOwnTime");
  }
  if (own(value, "webPlaces") && !isWebPlaceClaims(value.webPlaces)) {
    return semanticFailure("wrong_type", "webPlaces");
  }
  if (own(value, "placeRules") && !isPlaceRuleClaims(value.placeRules)) {
    return semanticFailure("wrong_type", "placeRules");
  }
  if (own(value, "contactStop") && !isContactStop(value.contactStop)) {
    return semanticFailure("wrong_type", "contactStop");
  }
  if (own(value, "interests") && !validInterests(value.interests)) {
    return semanticFailure("wrong_type", "interests");
  }
  if (own(value, "attention") && !isValidAttentionClaim(value.attention)) return semanticFailure("wrong_type", "attention");
  if (own(value, "senses") && !isValidSenseClaim(value.senses)) return semanticFailure("wrong_type", "senses");
  if (own(value, "growth") && !isValidGrowthClaim(value.growth)) {
    return semanticFailure("wrong_type", "growth");
  }
  if (own(value, "night") && !isValidNightClaim(value.night)) {
    return semanticFailure("wrong_type", "night");
  }
  if (own(value, "forget") && !isValidForgetClaim(value.forget)) {
    return semanticFailure("wrong_type", "forget");
  }
  result = validateEvidenceUse(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field);
  result = validateCommitmentBindings(value);
  if (!result.ok) return semanticFailure(result.code, result.field);
  result = validateSettlementLocalAliases(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field);
  return { ok: true, value: value as unknown as SettlementSemanticOutput };
}

function parseOperationSemantic(
  value: SemanticRecord,
  allowlist: ReadonlySet<string>,
  kind: "observation_intent" | "effect_intent",
  inspectAllowlist?: ReadonlySet<string>,
  concernDiscoverAllowed?: boolean,
): ThoughtSemanticParseResult {
  const required = kind === "observation_intent"
    ? ["kind", "operationKind", "request", "purpose", "evidenceNeed", "existingRefs"]
    : ["kind", "operationKind", "request", "purpose", "expectedOutcome", "existingRefs"];
  const record = recordShape(
    value,
    required,
    kind === "observation_intent" ? ["interimSpeech"] : [],
  );
  if (!record || record.kind !== kind) return semanticFailure("wrong_kind", "kind");
  if (typeof record.operationKind !== "string" || !REGISTERED_OPERATION_KIND_SET.has(record.operationKind)) {
    return semanticFailure("operation_not_registered", "operationKind");
  }
  if (!jsonObject(record.request)) return semanticFailure("wrong_type", "request");
  if (record.operationKind === "project.inspect" && !validProjectInspectionObjective(record.request)) {
    return semanticFailure("wrong_type", "request");
  }
  if (record.operationKind === "concern.inspect") {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    const requestKeys = Object.keys(record.request);
    const hasDiscover = requestKeys.includes("discover");
    const hasConcernRef = requestKeys.includes("concernRef");
    if (hasDiscover && hasConcernRef) return semanticFailure("wrong_type", "request");
    if (hasDiscover) {
      if (concernDiscoverAllowed !== true) {
        return semanticFailure("reference_not_allowlisted", "request.discover");
      }
      if (requestKeys.length !== 1) return semanticFailure("wrong_type", "request");
      const discover = semanticRecord((record.request as SemanticRecord).discover);
      if (!discover) return semanticFailure("wrong_type", "request.discover");
      const discoverAllowedKeys = new Set(["cursor", "limit"]);
      if (Object.keys(discover).some((key) => !discoverAllowedKeys.has(key))) {
        return semanticFailure("wrong_type", "request.discover");
      }
      if (own(discover, "cursor")) {
        if (typeof discover.cursor !== "string" || discover.cursor.length === 0) {
          return semanticFailure("wrong_type", "request.discover.cursor");
        }
      }
      if (own(discover, "limit")) {
        if (typeof discover.limit !== "number" || !Number.isInteger(discover.limit) || discover.limit < 1) {
          return semanticFailure("wrong_type", "request.discover.limit");
        }
      }
    } else {
      const shape = recordShape(record.request, ["concernRef"]);
      if (!shape || typeof shape.concernRef !== "string" || shape.concernRef.length === 0) {
        return semanticFailure("wrong_type", "request");
      }
      if (!existingRef(shape.concernRef, inspectAllowlist ?? new Set())) {
        return semanticFailure("reference_not_allowlisted", "request.concernRef");
      }
    }
  }
  if (isTypedInspectionOperationKind(record.operationKind)) {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    if (!isValidTypedInspectionRequest(record.operationKind, record.request)) {
      return semanticFailure("wrong_type", "request");
    }
  }
  if (isEvidenceOperationKind(record.operationKind)) {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    if (!isValidEvidenceOperationRequest(record.operationKind, record.request)) {
      return semanticFailure("wrong_type", "request");
    }
  }
  if (isWebSearchOperationKind(record.operationKind)) {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    if (!isValidWebSearchOperationRequest(record.operationKind, record.request)) {
      return semanticFailure("wrong_type", "request");
    }
  }
  if (record.operationKind === "web.request") {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    if (!isValidWebRequest(record.request)) return semanticFailure("wrong_type", "request");
  }
  if (isWebFetchOperationKind(record.operationKind)) {
    if (kind !== "observation_intent") return semanticFailure("wrong_type", "operationKind");
    if (!isValidWebFetchOperationRequest(record.operationKind, record.request)) {
      return semanticFailure("wrong_type", "request");
    }
  }
  if (record.operationKind === "candidate.develop") {
    const modeB = validateModeBRequest({ kind: record.operationKind, request: record.request });
    if (!modeB.ok) return semanticFailure("wrong_type", modeB.field ?? "request");
  }
  if (!nonEmptyString(record.purpose)) return semanticFailure("wrong_type", "purpose");
  if (!stringArray(record.existingRefs)) return semanticFailure("wrong_type", "existingRefs");
  if (!refArray(record.existingRefs, allowlist)) return semanticFailure("reference_not_allowlisted", "existingRefs");
  if (kind === "observation_intent") {
    if (!nonEmptyString(record.evidenceNeed)) return semanticFailure("wrong_type", "evidenceNeed");
    if (own(record, "interimSpeech")) {
      // An interim hold belongs only to the semantic project.inspect queue.
      // Every other branch rejects it structurally: settlement and abstain
      // through unknown-field rejection, effect_intent through the shape
      // above, and non-investigate observations here.
      if (record.operationKind !== "project.inspect") {
        return semanticFailure("wrong_type", "interimSpeech");
      }
      const interim = validateInterimSpeech(record.interimSpeech);
      if (!interim.ok) return semanticFailure(interim.code, interim.field);
    }
    return { ok: true, value: record as unknown as ObservationIntentSemanticOutput };
  }
  if (!nonEmptyString(record.expectedOutcome)) return semanticFailure("wrong_type", "expectedOutcome");
  return { ok: true, value: record as unknown as EffectIntentSemanticOutput };
}

export function parseThoughtSemanticOutput(
  raw: string | unknown,
  allowlistedReferences: ReadonlySet<string>,
  options?: { concernInspectRefs?: ReadonlySet<string>; concernDiscoverAllowed?: boolean },
): ThoughtSemanticParseResult {
  const parsed = parseSemanticJson(raw);
  if (!parsed.ok) return semanticFailure("invalid_json");
  const record = semanticRecord(parsed.value);
  if (!record) return semanticFailure("root_not_object");
  if (record.kind === "settlement") return parseSettlementSemantic(record, allowlistedReferences);
  if (record.kind === "observation_intent") {
    return parseOperationSemantic(
      record,
      allowlistedReferences,
      "observation_intent",
      options?.concernInspectRefs,
      options?.concernDiscoverAllowed,
    );
  }
  if (record.kind === "effect_intent") return parseOperationSemantic(record, allowlistedReferences, "effect_intent");
  if (record.kind === "abstain") {
    const unknown = Object.keys(record).find((key) => !["kind", "reason", "explanation", "evidenceRefs"].includes(key));
    if (unknown) return semanticFailure("unknown_field", unknown);
    if (!["kind", "reason", "explanation", "evidenceRefs"].every((key) => own(record, key))) {
      const missing = ["kind", "reason", "explanation", "evidenceRefs"].find((key) => !own(record, key));
      return semanticFailure("required_field_missing", missing);
    }
    if (!["insufficient_evidence", "unresolved_ambiguity", "no_responsible_proposal"].includes(record.reason as string)) {
      return semanticFailure("invalid_enum", "reason");
    }
    if (!nonEmptyString(record.explanation)) return semanticFailure("wrong_type", "explanation");
    if (!refArray(record.evidenceRefs, allowlistedReferences)) return semanticFailure("reference_not_allowlisted", "evidenceRefs");
    return { ok: true, value: record as unknown as AbstainSemanticOutput };
  }
  return semanticFailure(record.kind === undefined ? "required_field_missing" : "wrong_kind", "kind");
}

import type {
  AbstainSemanticOutput,
  ConcernSemanticDelta,
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
  | { ok: false; code: ThoughtSemanticParseFailureCode; field?: string };

type SemanticRecord = Record<string, unknown>;
type ValidationResult = { ok: true } | { ok: false; code: ThoughtSemanticParseFailureCode; field?: string };

const REGISTERED_OPERATION_KINDS = new Set([
  "conversation.read",
  "memory.lookup",
  "project.inspect",
  "project.list_directory",
  "project.read_file",
  "project.search_text",
  "workspace.create_directory",
  "workspace.delete_file",
  "workspace.edit_text",
  "workspace.list_directory",
  "workspace.read_file",
  "workspace.replace_file",
  "workspace.search_text",
  "workspace.verify",
  "workspace.write_file",
  "changeset.author",
  "objective.operate",
]);

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

function validEpistemicDimensions(value: unknown): boolean {
  const record = recordShape(value, ["source", "status", "time", "reliability"]);
  return !!record && [
    ["owner_utterance", "ashley_interpretation", "tool", "perception", "receipt", "prior_settlement"],
    ["asserted", "interpreted", "unverified", "contradicted", "superseded", "unresolved"],
    ["current", "historical", "unknown_freshness"],
    ["owner_supplied", "fallible_observation", "receipt_backed", "inferred", "unavailable_source"],
  ].every((allowed, index) => allowed.includes(record[["source", "status", "time", "reliability"][index]] as string));
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
  if (!record || !validEpistemicDimensions(record.dimensions) || !nonEmptyString(record.statement)) {
    return failure("wrong_type", field);
  }
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

function validateCommitments(parent: SemanticRecord, allowlist: ReadonlySet<string>): ValidationResult {
  const optional = optionalObject(parent, "commitments", ["epistemic", "operational", "conversational", "stance"]);
  if (!optional) return OK;
  if ("failure" in optional) return optional.failure;
  const record = optional.record;
  const conversational = ["answer", "ask", "acknowledge", "disagree", "hold", "silence"];
  if (own(record, "epistemic")) {
    if (!Array.isArray(record.epistemic)) return failure("wrong_type", "commitments.epistemic");
    if (record.epistemic.length === 0) return failure("empty_when_present", "commitments.epistemic");
    for (const [index, item] of (record.epistemic as unknown[]).entries()) {
      const result = validEpistemicCommitment(item, allowlist, `commitments.epistemic[${index}]`);
      if (!result.ok) return result;
    }
  }
  let result = prefixFailure(optionalArray(record, "operational", validOperationalClaim), "commitments");
  if (!result.ok) return result;
  result = prefixFailure(optionalArray(record, "conversational", (item) => typeof item === "string" && conversational.includes(item)), "commitments");
  if (!result.ok) return result;
  if (own(record, "stance") && !validStance(record.stance)) return failure("wrong_type", "commitments.stance");
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

function validWorkingContextItem(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["identity", "type", "text", "concernRef", "sourceTurnRefs", "status", "supersedesRef"]);
  const types = ["topic", "referent", "correction", "owner_teaching", "question", "commitment_temp", "repair"];
  const statuses = ["active", "superseded", "abandoned"];
  return !!record && semanticRef(record.identity, allowlist) && types.includes(record.type as string)
    && nonEmptyString(record.text) && validSemanticRefField(record.concernRef, allowlist)
    && refArray(record.sourceTurnRefs, allowlist) && statuses.includes(record.status as string)
    && validSemanticRefField(record.supersedesRef, allowlist);
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

function validConcernDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = semanticRecord(value);
  if (!record || typeof record.op !== "string") return false;
  if (record.op === "resolve") return Object.keys(record).length === 2 && existingRef(record.target, allowlist);
  if (record.op !== "upsert" || Object.keys(record).length !== 2) return false;
  const item = recordShape(record.record, ["identity", "statement", "sourceTurnRefs", "dimensions", "status"]);
  return !!item && semanticRef(item.identity, allowlist) && nonEmptyString(item.statement)
    && refArray(item.sourceTurnRefs, allowlist) && validEpistemicDimensions(item.dimensions)
    && ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"].includes(item.status as string);
}

function validOccupancyDelta(value: unknown, allowlist: ReadonlySet<string>): boolean {
  const record = recordShape(value, ["op", "concernRef", "status", "priority"]);
  return !!record && record.op === "set" && semanticRef(record.concernRef, allowlist)
    && ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"].includes(record.status as string)
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
  const subscription = item && recordShape(item.subscription, ["concernRef", "source", "scope", "topicKeys", "match", "expiresAtMs"]);
  return !!item && !!subscription && item.op === "create"
    && validSemanticRefField(subscription.concernRef, allowlist)
    && nonEmptyString(subscription.source) && nonEmptyString(subscription.scope)
    && stringArray(subscription.topicKeys)
    && (subscription.match === "equality" || subscription.match === "substring")
    && (subscription.expiresAtMs === null || (typeof subscription.expiresAtMs === "number" && Number.isInteger(subscription.expiresAtMs)));
}

function validNomination(value: unknown, allowlist: ReadonlySet<string>): value is ThoughtDurableNomination {
  const record = recordShape(value, ["statement", "memoryKind", "dimensions", "dataClassification", "sourceRefs", "supersedesRef", "concernRef"]);
  return !!record && nonEmptyString(record.statement) && isMemoryKind(record.memoryKind)
    && validEpistemicDimensions(record.dimensions)
    && ["ordinary", "sensitive", "never_public", "secret"].includes(record.dataClassification as string)
    && refArray(record.sourceRefs, allowlist)
    && (record.supersedesRef === null || existingRef(record.supersedesRef, allowlist))
    && validSemanticRefField(record.concernRef, allowlist);
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

function semanticFailure(code: ThoughtSemanticParseFailureCode, field?: string): ThoughtSemanticParseResult {
  return { ok: false, code, ...(field ? { field } : {}) };
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

function parseSettlementSemantic(value: SemanticRecord, allowlist: ReadonlySet<string>): ThoughtSemanticParseResult {
  const unknown = Object.keys(value).find((key) => ![
    "kind", "speech", "interpretation", "commitments", "workingContextDeltas", "concernDeltas",
    "occupancyDeltas", "futureTriggerDeltas", "subscriptionDeltas", "durableNominations", "evidenceUse",
  ].includes(key));
  if (unknown) return semanticFailure("unknown_field", unknown);
  if (value.kind !== "settlement") return semanticFailure("wrong_kind", "kind");
  if (!own(value, "speech")) return semanticFailure("required_field_missing", "speech");

  let result = validateSpeech(value.speech);
  if (!result.ok) return semanticFailure(result.code, result.field);
  result = validateInterpretation(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field);
  result = validateCommitments(value, allowlist);
  if (!result.ok) return semanticFailure(result.code, result.field);

  const arrays: Array<[string, (item: unknown) => boolean]> = [
    ["workingContextDeltas", (item) => validWorkingContextDelta(item, allowlist)],
    ["concernDeltas", (item) => validConcernDelta(item, allowlist)],
    ["occupancyDeltas", (item) => validOccupancyDelta(item, allowlist)],
    ["futureTriggerDeltas", (item) => validFutureTriggerDelta(item, allowlist)],
    ["subscriptionDeltas", (item) => validSubscriptionDelta(item, allowlist)],
    ["durableNominations", (item) => validNomination(item, allowlist)],
  ];
  for (const [key, validator] of arrays) {
    result = optionalArray(value, key, validator);
    if (!result.ok) return semanticFailure(result.code, result.field);
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
): ThoughtSemanticParseResult {
  const required = kind === "observation_intent"
    ? ["kind", "operationKind", "request", "purpose", "evidenceNeed", "existingRefs"]
    : ["kind", "operationKind", "request", "purpose", "expectedOutcome", "existingRefs"];
  const record = recordShape(value, required);
  if (!record || record.kind !== kind) return semanticFailure("wrong_kind", "kind");
  if (typeof record.operationKind !== "string" || !REGISTERED_OPERATION_KINDS.has(record.operationKind)) {
    return semanticFailure("operation_not_registered", "operationKind");
  }
  if (!jsonObject(record.request)) return semanticFailure("wrong_type", "request");
  if (!nonEmptyString(record.purpose)) return semanticFailure("wrong_type", "purpose");
  if (!stringArray(record.existingRefs)) return semanticFailure("wrong_type", "existingRefs");
  if (!refArray(record.existingRefs, allowlist)) return semanticFailure("reference_not_allowlisted", "existingRefs");
  if (kind === "observation_intent") {
    if (!nonEmptyString(record.evidenceNeed)) return semanticFailure("wrong_type", "evidenceNeed");
    return { ok: true, value: record as unknown as ObservationIntentSemanticOutput };
  }
  if (!nonEmptyString(record.expectedOutcome)) return semanticFailure("wrong_type", "expectedOutcome");
  return { ok: true, value: record as unknown as EffectIntentSemanticOutput };
}

export function parseThoughtSemanticOutput(
  raw: string | unknown,
  allowlistedReferences: ReadonlySet<string>,
): ThoughtSemanticParseResult {
  const parsed = parseSemanticJson(raw);
  if (!parsed.ok) return semanticFailure("invalid_json");
  const record = semanticRecord(parsed.value);
  if (!record) return semanticFailure("root_not_object");
  if (record.kind === "settlement") return parseSettlementSemantic(record, allowlistedReferences);
  if (record.kind === "observation_intent") return parseOperationSemantic(record, allowlistedReferences, "observation_intent");
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

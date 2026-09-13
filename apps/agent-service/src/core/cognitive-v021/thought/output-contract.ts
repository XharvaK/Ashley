import {
  THOUGHT_OUTPUT_CONTRACT_ID,
  THOUGHT_OUTPUT_SCHEMA_ID,
} from "../../model-fabric/dispatch-contract.js";
import { sha256 } from "../../model-fabric/hash.js";
import { MEMORY_KINDS } from "../memory/kinds.js";
import type { OperationalEffectNamespace } from "../effect/effect-ref.js";
import type {
  StructuredOutputRequest,
  StructuredOutputSchemaFingerprint,
} from "../../model-fabric/types.js";

export const THOUGHT_FORBIDDEN_OUTPUT_FIELDS = [
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
] as const;

const strictObject = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: "object",
  required,
  properties,
  additionalProperties: false,
});

const stringArraySchema = { type: "array", items: { type: "string" } };
const existingRefSchema = { type: "string", minLength: 1 };
const existingSemanticRefSchema = strictObject(
  { kind: { const: "existing" }, ref: { type: "string", minLength: 1 } },
  ["kind", "ref"],
);
const localRefSchema = strictObject(
  { kind: { const: "local" }, alias: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,127}$" } },
  ["kind", "alias"],
);
const localAliasSchema = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,127}$" };
const semanticRefSchema = { oneOf: [existingSemanticRefSchema, localRefSchema] };
const nullableSemanticRefSchema = { oneOf: [semanticRefSchema, { type: "null" }] };
const jsonObjectSchema = { type: "object", additionalProperties: true };
const REGISTERED_OPERATION_KINDS = [
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
] as const;
const dimensionsSchema = strictObject({
  source: { enum: ["owner_utterance", "ashley_interpretation", "tool", "perception", "receipt", "prior_settlement"] },
  status: { enum: ["asserted", "interpreted", "unverified", "contradicted", "superseded", "unresolved"] },
  time: { enum: ["current", "historical", "unknown_freshness"] },
  reliability: { enum: ["owner_supplied", "fallible_observation", "receipt_backed", "inferred", "unavailable_source"] },
}, ["source", "status", "time", "reliability"]);
const operationalClaimSchema = strictObject({
  effectRef: { type: "string", minLength: 1 },
  claimedState: { enum: ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"] },
}, ["effectRef", "claimedState"]);
const referentBindingSchema = strictObject({
  span: { type: "string" }, concernRef: existingRefSchema, entityRef: existingRefSchema,
  sourceTurnRefs: stringArraySchema,
}, ["span", "sourceTurnRefs"]);
const correctionSchema = strictObject({
  correctedTurnRefs: stringArraySchema, fromSpan: { type: "string" }, toSpan: { type: "string" }, concernRef: existingRefSchema,
}, ["correctedTurnRefs", "fromSpan", "toSpan"]);
const semanticItemSchema = strictObject({
  identity: semanticRefSchema, type: { enum: ["topic", "referent", "correction", "owner_teaching", "question", "commitment_temp", "repair"] },
  text: { type: "string" }, concernRef: nullableSemanticRefSchema, sourceTurnRefs: stringArraySchema,
  status: { enum: ["active", "superseded", "abandoned"] }, supersedesRef: nullableSemanticRefSchema,
}, ["identity", "type", "text", "concernRef", "sourceTurnRefs", "status", "supersedesRef"]);
const workingContextDeltaSchema = { oneOf: [
  strictObject({ op: { const: "upsert" }, item: semanticItemSchema }, ["op", "item"]),
  strictObject({ op: { const: "supersede" }, target: existingRefSchema, replacement: semanticItemSchema }, ["op", "target", "replacement"]),
  strictObject({ op: { const: "abandon" }, target: existingRefSchema }, ["op", "target"]),
] };
const concernRecordSchema = strictObject({
  identity: semanticRefSchema, statement: { type: "string" }, sourceTurnRefs: stringArraySchema, dimensions: dimensionsSchema,
  status: { enum: ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"] },
}, ["identity", "statement", "sourceTurnRefs", "dimensions", "status"]);
const concernDeltaSchema = { oneOf: [
  strictObject({ op: { const: "upsert" }, record: concernRecordSchema }, ["op", "record"]),
  strictObject({ op: { const: "resolve" }, target: existingRefSchema }, ["op", "target"]),
] };
const occupancyDeltaSchema = strictObject({
  op: { const: "set" }, concernRef: semanticRefSchema,
  status: { enum: ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"] }, priority: { type: "integer" },
}, ["op", "concernRef", "status", "priority"]);
const futureTriggerDeltaSchema = { oneOf: [
  strictObject({ op: { const: "create" }, concernRef: semanticRefSchema, dueAtMs: { type: "integer" }, purpose: { type: "string" }, payload: jsonObjectSchema }, ["op", "concernRef", "dueAtMs", "purpose", "payload"]),
  strictObject({ op: { const: "cancel" }, target: existingRefSchema }, ["op", "target"]),
] };
const subscriptionDeltaSchema = { oneOf: [
  strictObject({ op: { const: "create" }, subscription: strictObject({ concernRef: nullableSemanticRefSchema, source: { type: "string" }, scope: { type: "string" }, topicKeys: stringArraySchema, match: { enum: ["equality", "substring"] }, expiresAtMs: { type: ["integer", "null"] } }, ["concernRef", "source", "scope", "topicKeys", "match", "expiresAtMs"]) }, ["op", "subscription"]),
  strictObject({ op: { const: "cancel" }, target: existingRefSchema }, ["op", "target"]),
] };
const nominationSchema = strictObject({
  statement: { type: "string" }, memoryKind: { enum: [...MEMORY_KINDS] }, dimensions: dimensionsSchema,
  dataClassification: { enum: ["ordinary", "sensitive", "never_public", "secret"] }, sourceRefs: stringArraySchema,
  supersedesRef: { oneOf: [existingRefSchema, { type: "null" }] }, concernRef: nullableSemanticRefSchema,
}, ["statement", "memoryKind", "dimensions", "dataClassification", "sourceRefs", "supersedesRef", "concernRef"]);
const presentArray = (items: unknown): Record<string, unknown> => ({ type: "array", minItems: 1, items });
const sparseObject = (properties: Record<string, unknown>): Record<string, unknown> => ({
  ...strictObject(properties, []), minProperties: 1,
});
const nonEmptyStringArraySchema = presentArray({ type: "string" });
const semanticOutputSettlementSchema = strictObject({
  kind: { const: "settlement" },
  interpretation: sparseObject({
    discourseActs: { type: "array", minItems: 1, items: { enum: ["inform", "ask", "correct", "acknowledge", "disagree", "hold", "silence", "other"] } },
    referentBindings: { type: "array", minItems: 1, items: referentBindingSchema },
    corrections: { type: "array", minItems: 1, items: correctionSchema },
    unresolvedAmbiguities: nonEmptyStringArraySchema,
    topics: nonEmptyStringArraySchema,
  }),
  commitments: sparseObject({
    epistemic: { type: "array", minItems: 1, items: strictObject({ dimensions: dimensionsSchema, statement: { type: "string" }, surfaceSpan: { type: "string", minLength: 1 }, observationRefs: nonEmptyStringArraySchema }, ["dimensions", "statement"]) },
    operational: { type: "array", minItems: 1, items: operationalClaimSchema },
    conversational: { type: "array", minItems: 1, items: { enum: ["answer", "ask", "acknowledge", "disagree", "hold", "silence"] } },
    stance: strictObject({
      warmth: { enum: ["low", "medium", "high"] },
      humorAllowed: { type: "boolean" }, disagreement: { type: "boolean" }, uncertaintyDisplay: { type: "boolean" },
    }, ["warmth", "humorAllowed", "disagreement", "uncertaintyDisplay"]),
  }),
  speech: { oneOf: [
    strictObject({ mode: { const: "none" } }, ["mode"]),
    strictObject({ mode: { const: "draft" }, mustSay: nonEmptyStringArraySchema, mustNotSay: nonEmptyStringArraySchema, surfaceDraft: { type: "string", minLength: 1 }, presentationDirectives: nonEmptyStringArraySchema }, ["mode", "surfaceDraft"]),
  ] },
  workingContextDeltas: { type: "array", minItems: 1, items: workingContextDeltaSchema },
  concernDeltas: { type: "array", minItems: 1, items: concernDeltaSchema },
  occupancyDeltas: { type: "array", minItems: 1, items: occupancyDeltaSchema },
  futureTriggerDeltas: { type: "array", minItems: 1, items: futureTriggerDeltaSchema },
  subscriptionDeltas: { type: "array", minItems: 1, items: subscriptionDeltaSchema },
  durableNominations: { type: "array", minItems: 1, items: nominationSchema },
  evidenceUse: sparseObject({
    observationRefsUsed: nonEmptyStringArraySchema, retrievalRefsUsed: nonEmptyStringArraySchema,
    sourceRefsUsed: nonEmptyStringArraySchema, openIntentRefs: nonEmptyStringArraySchema,
  }),
  }, ["kind", "speech"]);

const semanticOutputSettlementForm = {
  ...semanticOutputSettlementSchema,
  description: "Use settlement only when the current supplied evidence and context are sufficient to author the semantic answer without first acquiring additional evidence or performing a governed effect. Do not use settlement as a placeholder for an unperformed observation or effect.",
};
const semanticOutputObservationForm = {
  ...strictObject({
    kind: { const: "observation_intent" }, operationKind: { enum: REGISTERED_OPERATION_KINDS }, request: jsonObjectSchema,
    purpose: { type: "string", minLength: 1 }, evidenceNeed: { type: "string", minLength: 1 }, existingRefs: stringArraySchema,
  }, ["kind", "operationKind", "request", "purpose", "evidenceNeed", "existingRefs"]),
  description: "Use observation_intent when the answer requires additional read-only evidence acquisition through a registered observation capability.",
};
const semanticOutputEffectForm = {
  ...strictObject({
    kind: { const: "effect_intent" }, operationKind: { enum: REGISTERED_OPERATION_KINDS }, request: jsonObjectSchema,
    purpose: { type: "string", minLength: 1 }, expectedOutcome: { type: "string", minLength: 1 }, existingRefs: stringArraySchema,
  }, ["kind", "operationKind", "request", "purpose", "expectedOutcome", "existingRefs"]),
  description: "Use effect_intent when the requested outcome requires a governed mechanical effect through a registered effect capability.",
};
const semanticOutputAbstainForm = {
  ...strictObject({
    kind: { const: "abstain" },
    reason: { enum: ["insufficient_evidence", "unresolved_ambiguity", "no_responsible_proposal"] },
    explanation: { type: "string", minLength: 1 }, evidenceRefs: stringArraySchema,
  }, ["kind", "reason", "explanation", "evidenceRefs"]),
  description: "Use abstain when required evidence, capability, or an admissible basis is absent or unresolved; this is a semantic decision, not a provider, parser, or deadline failure.",
};

export const THOUGHT_OUTPUT_SCHEMA: Readonly<Record<string, unknown>> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: THOUGHT_OUTPUT_SCHEMA_ID,
  title: "Ashley Thought semantic output v2",
  oneOf: [
    semanticOutputSettlementForm,
    semanticOutputObservationForm,
    semanticOutputEffectForm,
    semanticOutputAbstainForm,
  ],
  $defs: { semanticRef: semanticRefSchema, existingRef: existingRefSchema, localAlias: localAliasSchema, jsonObject: jsonObjectSchema },
};

export const THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT = `sha256:${sha256(
  THOUGHT_OUTPUT_SCHEMA,
)}` as StructuredOutputSchemaFingerprint;

/** Backward-compatible name for the stable canonical semantic fingerprint. */
export const THOUGHT_OUTPUT_SCHEMA_FINGERPRINT = THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT;

type SchemaRecord = Record<string, unknown>;

function record(value: unknown): SchemaRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as SchemaRecord
    : {};
}

function requiredFields(value: unknown): string[] {
  const required = record(value).required;
  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === "string")
    : [];
}

function property(value: unknown, key: string): SchemaRecord {
  return record(record(value).properties)[key] as SchemaRecord ?? {};
}

function valueDescription(value: unknown): string {
  const shape = record(value);
  if (Object.prototype.hasOwnProperty.call(shape, "const")) {
    return JSON.stringify(shape.const);
  }
  if (typeof shape.type === "string") return shape.type;
  if (typeof shape.$ref === "string") return shape.$ref;
  return "value";
}

function rootForms(): string[] {
  const branches = record(THOUGHT_OUTPUT_SCHEMA).oneOf;
  if (!Array.isArray(branches)) return [];
  return branches.map((branch) => {
    const shape = record(branch);
    const kind = valueDescription(property(shape, "kind"));
    return `${kind} required=${requiredFields(shape).join(",")}`;
  });
}

function speechForms(settlement: SchemaRecord): string[] {
  const forms = record(property(settlement, "speech")).oneOf;
  if (!Array.isArray(forms)) return [];
  return forms.map((form) => {
    const shape = record(form);
    return `mode=${valueDescription(property(shape, "mode"))}, required=${requiredFields(shape).join(",")}, surfaceDraft=${valueDescription(property(shape, "surfaceDraft"))}`;
  });
}

function rootBranchKind(branch: unknown): string {
  const kind = property(record(branch), "kind").const;
  if (typeof kind !== "string") throw new Error("thought_schema_branch_kind_missing");
  return kind;
}

function rootFieldForms(): string[] {
  const branches = record(THOUGHT_OUTPUT_SCHEMA).oneOf;
  if (!Array.isArray(branches)) return [];
  return branches.map((branch) => {
    const shape = record(branch);
    return `${rootBranchKind(shape)} fields=${JSON.stringify(Object.keys(record(shape.properties)))} required=${JSON.stringify(requiredFields(shape))}`;
  });
}

const DEEPSEEK_JSON_OBJECT_PROTOCOL = [
  "DeepSeek JSON_OBJECT compatibility protocol for Ashley Thought.",
  "Return exactly one JSON object and no Markdown, prose, code fence, or second object.",
  "Choose exactly one canonical semantic branch: settlement, observation_intent, effect_intent, or abstain.",
  "The branch field kind is mandatory and must be one of those four exact strings.",
  "Branch exclusivity is mandatory: emit only fields belonging to the selected branch; omit every field belonging exclusively to every other branch.",
  "Canonical branch fields and required fields, derived from the current Ashley semantic schema:",
  ...rootFieldForms(),
  "If kind=settlement, emit only the settlement fields listed above.",
  "If kind=observation_intent, emit only the observation_intent fields listed above.",
  "If kind=effect_intent, emit only the effect_intent fields listed above.",
  "If kind=abstain, emit only the abstain fields listed above.",
  "The following examples are synthetic, generic, fixture-independent, owner-independent, and shape-only. They do not answer the supplied situation and must not be copied as its semantic content:",
  'settlement example: {"kind":"settlement","speech":{"mode":"none"}}',
  'observation_intent example: {"kind":"observation_intent","operationKind":"project.read_file","request":{"projectId":"example-project","path":"example.txt"},"purpose":"obtain an example read-only observation","evidenceNeed":"example evidence","existingRefs":[]}',
  'effect_intent example: {"kind":"effect_intent","operationKind":"workspace.verify","request":{"projectId":"example-project"},"purpose":"obtain an example governed verification","expectedOutcome":"an example verification result","existingRefs":[]}',
  'abstain example: {"kind":"abstain","reason":"insufficient_evidence","explanation":"an example required source is unavailable","evidenceRefs":[]}',
  "These examples teach output shape only. Decide the branch and every field value from the supplied Ashley Thought context.",
].join("\n");

export function thoughtOutputDeepSeekJsonObjectInstruction(): string {
  return DEEPSEEK_JSON_OBJECT_PROTOCOL;
}

export type ConstrainedThoughtOutputSchema = Readonly<{
  schema: Readonly<Record<string, unknown>>;
  namespaceConstraintFingerprint: `sha256:${string}`;
  wireSchemaFingerprint: StructuredOutputSchemaFingerprint;
}>;

function cloneSchema(schema: Readonly<Record<string, unknown>>): SchemaRecord {
  return JSON.parse(JSON.stringify(schema)) as SchemaRecord;
}

function settlementCommitmentsSchema(schema: SchemaRecord): SchemaRecord {
  const branches = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const settlement = branches
    .map((branch) => record(branch))
    .find((branch) => valueDescription(property(branch, "kind")) === JSON.stringify("settlement"));
  const commitments = property(settlement, "commitments");
  if (!settlement || Object.keys(commitments).length === 0) {
    throw new Error("thought_schema_commitments_shape_missing");
  }
  return commitments;
}

/**
 * Derive the exact provider wire schema without mutating the stable semantic
 * schema. Only the Host-owned operational effect reference namespace varies.
 */
function applyExperimentalWireBounds(schema: SchemaRecord): void {
  // EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT: qualification may revise
  // these limits. They are resource bounds, never canonical semantic law.
  const settlement = record((schema.oneOf as unknown[])[0]);
  const interpretation = property(settlement, "interpretation");
  const commitments = property(settlement, "commitments");
  const speech = property(settlement, "speech");
  const draft = (speech.oneOf as unknown[]).map(record).find((form) => property(form, "mode").const === "draft")!;
  property(draft, "surfaceDraft").maxLength = 6000;
  for (const [field, max] of [["mustSay", 300], ["mustNotSay", 200], ["presentationDirectives", 200]] as const) record(property(draft, field).items).maxLength = max;
  for (const [field, max] of [["referentBindings", 12], ["corrections", 6], ["unresolvedAmbiguities", 12], ["topics", 16]] as const) property(interpretation, field).maxItems = max;
  record(property(interpretation, "topics").items).maxLength = 100;
  record(property(interpretation, "unresolvedAmbiguities").items).maxLength = 400;
  property(record(property(interpretation, "referentBindings").items), "span").maxLength = 400;
  for (const field of ["fromSpan", "toSpan"]) property(record(property(interpretation, "corrections").items), field).maxLength = 400;
  property(record(property(commitments, "epistemic").items), "statement").maxLength = 500;
  property(record(property(commitments, "epistemic").items), "surfaceSpan").maxLength = 500;
  for (const branch of record(property(settlement, "workingContextDeltas").items).oneOf as unknown[]) {
    const form = record(branch);
    for (const field of ["item", "replacement"]) {
      const item = property(form, field);
      if (Object.keys(item).length) property(item, "text").maxLength = 500;
    }
  }
  property(property(record((record(property(settlement, "concernDeltas").items).oneOf as unknown[])[0]), "record"), "statement").maxLength = 500;
  property(record((record(property(settlement, "futureTriggerDeltas").items).oneOf as unknown[])[0]), "purpose").maxLength = 300;
  property(record(property(settlement, "durableNominations").items), "statement").maxLength = 800;
}

export function constrainThoughtOutputSchema(
  namespace: OperationalEffectNamespace,
): ConstrainedThoughtOutputSchema {
  const schema = cloneSchema(THOUGHT_OUTPUT_SCHEMA);
  applyExperimentalWireBounds(schema);
  const commitments = settlementCommitmentsSchema(schema);
  const operational = property(commitments, "operational");
  if (Object.keys(operational).length === 0) {
    throw new Error("thought_schema_operational_shape_missing");
  }
  const refs = [...namespace.allowedOperationalEffectRefs];
  if (refs.length === 0) {
    // NIM rejects the otherwise truthful zero-cardinality operational array.
    // Strict commitments still reject the property if a model attempts it.
    delete record(commitments.properties).operational;
  } else {
    delete operational.maxItems;
    const items = record(operational.items);
    const properties = record(items.properties);
    const effectRef = property(items, "effectRef");
    if (Object.keys(effectRef).length === 0) {
      throw new Error("thought_schema_effect_ref_shape_missing");
    }
    effectRef.enum = refs;
    properties.effectRef = effectRef;
    items.properties = properties;
    operational.items = items;
  }
  const wireSchemaFingerprint = `sha256:${sha256(schema)}` as StructuredOutputSchemaFingerprint;
  return {
    schema,
    namespaceConstraintFingerprint: namespace.fingerprint,
    wireSchemaFingerprint,
  };
}

/** Compact compatibility guidance derived from the same code-owned schema. */
export function thoughtOutputCompatibilityInstruction(): string {
  const settlement = record(THOUGHT_OUTPUT_SCHEMA.oneOf instanceof Array ? THOUGHT_OUTPUT_SCHEMA.oneOf[0] : null);
  return [
    `Code-owned Thought contract contractId=${THOUGHT_OUTPUT_CONTRACT_ID} schemaId=${THOUGHT_OUTPUT_SCHEMA_ID} semanticSchemaFingerprint=${THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT}.`,
    `Return exactly one JSON object in one of these permitted kinds/forms: ${rootForms().join("; ")}.`,
    "Semantic selection rules: choose settlement only when the current supplied evidence and context are sufficient to author the semantic answer without first acquiring additional evidence or performing a governed effect; choose observation_intent when the answer requires additional read-only evidence acquisition through a registered observation capability; choose effect_intent when the requested outcome requires a governed mechanical effect through a registered effect capability; choose abstain when required evidence, capability, or an admissible basis is absent or unresolved.",
    "Do not use settlement as a placeholder for an unperformed observation or effect. If a required observation or effect cannot be truthfully authored from the current admissible context, use abstain rather than claim completion.",
    "Choose observation_intent only when an available observation can actually supply evidence capable of resolving the current semantic need; the availability of an unrelated observation does not justify observation, and when no available observation can supply the needed evidence, abstain takes precedence over observation.",
    "Epistemic time is a governed evidence status, not ordinary conversational recency. Use time:current only for a factual claim whose present truth is supported by a governed observation supplied in the current Thought input, and nominate the supporting observation in evidenceUse.observationRefsUsed; a source reference, a retrieval reference, or the fact that the owner just sent a message does not by itself license current, and the host may still reject a current claim whose currentness binding is incomplete. Use time:historical for a claim about a past state or event that does not assert it is still true now. Use time:unknown_freshness when evidence supports a claim but its present truth has not been established by governed current observation. If a conversational response such as an acknowledgment does not need to assert an epistemic fact, omit the epistemic commitment (omit unused arrays) rather than inventing one.",
    "Capability reality is host-owned input: operationCapabilities identify available operations, their canonical family, readOnly and requiresProject properties, observation/effect class, request fields, operator-bound fields, and authorized project IDs. Use only available operations and authorized IDs; operation metadata does not choose whether to request an operation, but its semantic class constrains the form that can carry a selected operation.",
    'Semantic class binding: semanticClass:"observation" requires observation_intent; semanticClass:"effect" requires effect_intent. readOnly describes whether the governed operation mutates its bound project or candidate; readOnly does not convert an effect-class operation into an observation. project.read_file is project_inspection evidence acquisition and uses observation_intent. workspace.verify is project_verification governed recipe execution and uses effect_intent even when read-only.',
    "CapabilityReality field semantics: conversationalRead reports only whether an additional authorized user-requested URL/page read may be performed; it does not report whether supplied conversation content is visible. Every rawConversation entry included in this request is directly readable current context regardless of conversationalRead.",
    "Do not emit kernel identity, lifecycle, delivery, or publication fields; Ashley code binds those values.",
    `A settlement must include these required sections: ${requiredFields(settlement).join(", ")}.`,
    `Speech shape: ${speechForms(settlement).join("; ")}.`,
    "Speech mustSay contract: every mustSay entry is a literal required substring and each entry must appear verbatim in surfaceDraft; the host fidelity checker rejects any draft that does not contain them verbatim. Omit mustSay when no exact literal wording is required. Behavioral, stylistic, or procedural directives do not belong in mustSay; put those in presentationDirectives.",
    "Optional settlement domains and their children must be omitted when unused. Present event arrays must be non-empty; present composite objects must contain a meaningful child. Ordinary speech requires no commitments. speech.mode:none permits only mode. Absence never clears state.",
    "Ordinary speech still requires no commitments. When Ashley's own surface wording makes a governed external read, discovery, or vision claim, author an epistemic commitment with the exact literal surfaceSpan quoted from surfaceDraft and the exact supporting observationRefs chosen from the supplied Thought input observations; every claim observationRef must also appear in evidenceUse.observationRefsUsed, and the host licenses each surface claim only against its own commitment's refs. When detector-prone wording is purely Ashley's conversational interpretation, use source:ashley_interpretation with status:interpreted plus the exact surfaceSpan and do not fabricate observationRefs. Omit surfaceSpan and observationRefs when unused; a surfaceSpan must occur exactly once in surfaceDraft and bound spans must not overlap.",
    "Every commitments.epistemic item must contain a dimensions object and a statement string. dimensions must contain source, status, time, and reliability; source, status, time, and reliability belong only inside dimensions. MUST NOT place source, status, time, or reliability directly on the epistemic item. surfaceSpan is optional and, when present, must be the exact literal substring of speech.surfaceDraft. observationRefs is optional and, when present, must contain only exact observation IDs supplied in the current Thought input.",
    `Canonical epistemic item shape: {"dimensions":{"source":"<allowed source>","status":"<allowed status>","time":"<allowed time>","reliability":"<allowed reliability>"},"statement":"<epistemic proposition>", optional "surfaceSpan":"<exact literal substring of speech.surfaceDraft>", optional "observationRefs":["<exact supplied observationId>"]}.`,
    `Interpretive example (structure only; do not require this exact statement): {"dimensions":{"source":"ashley_interpretation","status":"interpreted","time":"unknown_freshness","reliability":"inferred"},"statement":"Ashley interprets the phrase as meaning reachable again.","surfaceSpan":"I read 'online' as 'reachable again'."}; omit observationRefs for this form.`,
    `Current page-backed example (structure only): {"dimensions":{"source":"tool","status":"asserted","time":"current","reliability":"fallible_observation"},"statement":"The page says the fixture marker is amber.","surfaceSpan":"I read the page: the F2 qualification fixture marker is amber.","observationRefs":["example-observation-id"]}; put the same claim refs in evidenceUse.observationRefsUsed. Use only observation IDs actually supplied in the current Thought input; example-observation-id is illustrative and MUST NOT be fabricated.`,
    "speech.mode:none means Ashley intentionally chooses not to communicate in this cycle; it is not the generic no-op for a turn with no other work. The absence of a new belief, commitment, state change, concern update, operation, or other structured act does not by itself imply silence: a settlement may carry speech.mode:draft alone, and ordinary conversation is itself a valid purpose for speech. When the Owner directly addresses Ashley or makes a conversational bid — such as a greeting, question, presence check, or remark directed at Ashley — participating is ordinarily a legitimate reason to speak even when no other update is required; silence remains fully valid when silence itself is the intended act, such as deliberate withdrawal, refusal, choosing not to interrupt, or a tick with nothing Ashley wants to say.",
    "Operational commitments are distinct from conversational continuation. Every operational effectRef must refer to one of the complete Host-admitted operational effect references supplied in allowedOperationalEffectRefs for this cycle. If allowedOperationalEffectRefs is empty, omit commitments.operational.",
    `Forbidden publication/delivery fields: ${THOUGHT_FORBIDDEN_OUTPUT_FIELDS.join(", ")}.`,
    "This contract describes output shape only; branch selection is Thought-owned, while Ashley code remains authoritative for identity, authority, licensing, and publication.",
  ].join(" ");
}

export function thoughtOutputStructuredRequest(
  namespace?: OperationalEffectNamespace,
): StructuredOutputRequest {
  const constrained = namespace === undefined ? null : constrainThoughtOutputSchema(namespace);
  return {
    contractId: THOUGHT_OUTPUT_CONTRACT_ID,
    schemaId: THOUGHT_OUTPUT_SCHEMA_ID,
    schemaFingerprint: constrained?.wireSchemaFingerprint ?? THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT,
    schema: constrained?.schema ?? THOUGHT_OUTPUT_SCHEMA,
  };
}

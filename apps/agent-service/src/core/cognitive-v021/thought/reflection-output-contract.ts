import {
  REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID,
  REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID,
} from "./contract-identity.js";
import { sha256 } from "../../model-fabric/hash.js";
import type {
  StructuredOutputRequest,
  StructuredOutputSchemaFingerprint,
} from "../../model-fabric/types.js";
import { entityName } from "../../entity-names.js";

/**
 * Wire schema for the Reflection/Initiative adjudication contract.
 *
 * This is deliberately NOT the Thought semantic envelope. Reflection
 * adjudicates an Open Cognitive Item transition and returns a
 * non-authoritative advisory proposal, so it carries its own closed action set
 * and its own evidence-reference shape.
 */
export const REFLECTION_INITIATIVE_OUTPUT_SCHEMA: Readonly<Record<string, unknown>> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID,
  get title() {
    return `${entityName()} Reflection/Initiative adjudication output v1`;
  },
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["keep", "keep_open", "withdraw", "supersede", "resolve"],
    },
    reason: { type: "string" },
    evidenceRefs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id"],
        properties: {
          type: { type: "string" },
          id: { type: ["string", "number"] },
        },
      },
    },
    replacementEntityUuid: { type: "string" },
  },
};

export function reflectionInitiativeSchemaFingerprint(): StructuredOutputSchemaFingerprint {
  return `sha256:${sha256(REFLECTION_INITIATIVE_OUTPUT_SCHEMA)}` as StructuredOutputSchemaFingerprint;
}

export const REFLECTION_INITIATIVE_SCHEMA_FINGERPRINT = reflectionInitiativeSchemaFingerprint();

export function reflectionInitiativeOutputStructuredRequest(): StructuredOutputRequest {
  return {
    contractId: REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID,
    schemaId: REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID,
    schemaFingerprint: reflectionInitiativeSchemaFingerprint(),
    schema: REFLECTION_INITIATIVE_OUTPUT_SCHEMA,
  };
}

function reflectionJsonObjectProtocol(): string {
  return [
  `JSON_OBJECT compatibility protocol for ${entityName()} Reflection/Initiative adjudication.`,
  "Return exactly one JSON object and no Markdown, prose, code fence, or second object.",
  "This is a bounded advisory adjudication, not a Thought turn.",
  "Do not emit a Thought semantic envelope and do not use the fields kind, speech, settlement, observation_intent, effect_intent, or abstain.",
  'The field "action" is mandatory and must be exactly one of: keep, keep_open, withdraw, supersede, resolve.',
  "You may include an optional short string reason.",
  'You may include an optional "evidenceRefs" array whose entries each have a string "type" and a string or number "id".',
  'You may include an optional string "replacementEntityUuid".',
  "Emit no field that is not listed above.",
  "Answer with the object only.",
  ].join("\n");
}

export function reflectionInitiativeJsonObjectInstruction(): string {
  return reflectionJsonObjectProtocol();
}

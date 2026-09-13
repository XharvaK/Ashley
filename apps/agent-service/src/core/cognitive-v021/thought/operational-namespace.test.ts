import { describe, expect, it } from "vitest";
import {
  buildOperationalEffectNamespaceFromRefs,
} from "../effect/effect-ref.js";
import {
  THOUGHT_OUTPUT_SCHEMA,
  THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT,
  constrainThoughtOutputSchema,
  thoughtOutputStructuredRequest,
} from "./output-contract.js";
import { validateQualificationSchema } from "../qualification/thought-capability-qualification.js";
import { buildNimRequestBody } from "../../model-routing/adapters/nim-adapter.js";
import { createInferencePolicyFingerprint } from "../../model-fabric/profiles.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";

type SchemaRecord = Record<string, any>;

function settlement(operational: unknown[]) {
  return {
    kind: "settlement",
    commitments: {
      conversational: ["acknowledge"],
      ...(operational.length > 0 ? { operational } : {}),
      stance: {
        warmth: "medium",
        humorAllowed: false,
        disagreement: false,
        uncertaintyDisplay: true,
      },
    },
    speech: {
      mode: "none",
    },
  };
}

function operationalSchema(schema: Readonly<Record<string, unknown>>): SchemaRecord {
  const settlementBranch = (schema.oneOf as SchemaRecord[]).find(
    (branch) => branch.properties?.kind?.const === "settlement",
  );
  if (!settlementBranch) throw new Error("settlement_schema_missing");
  return settlementBranch.properties.commitments.properties.operational;
}

describe("finite operational effect namespace constraints", () => {
  it("keeps the canonical schema stable while deriving a zero-reference wire schema", () => {
    const canonicalBefore = JSON.stringify(THOUGHT_OUTPUT_SCHEMA);
    const namespace = buildOperationalEffectNamespaceFromRefs([]);
    const constrained = constrainThoughtOutputSchema(namespace);

    expect(JSON.stringify(THOUGHT_OUTPUT_SCHEMA)).toBe(canonicalBefore);
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toMatch(/^sha256:[0-9a-f]{64}$/);
    const settlementBranch = (constrained.schema.oneOf as SchemaRecord[]).find(
      (branch) => branch.properties?.kind?.const === "settlement",
    );
    expect(settlementBranch?.properties?.commitments?.properties?.operational).toBeUndefined();
    expect(constrained.namespaceConstraintFingerprint).toBe(namespace.fingerprint);
    expect(constrained.wireSchemaFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(constrained.wireSchemaFingerprint).not.toBe(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT);
  });

  it("makes an empty operational array valid and any operational item invalid at the schema boundary", () => {
    const constrained = constrainThoughtOutputSchema(buildOperationalEffectNamespaceFromRefs([]));

    expect(validateQualificationSchema(settlement([]), constrained.schema)).toMatchObject({ ok: true });
    expect(validateQualificationSchema(
      settlement([{ effectRef: "effect:invented", claimedState: "in_progress" }]),
      constrained.schema,
    )).toMatchObject({ ok: false });
  });

  it("narrows one allowed effect to an exact enum without requiring an operational commitment", () => {
    const namespace = buildOperationalEffectNamespaceFromRefs(["effect:A"]);
    const constrained = constrainThoughtOutputSchema(namespace);

    expect(operationalSchema(constrained.schema).items.properties.effectRef.enum).toEqual(["effect:A"]);
    expect(validateQualificationSchema(settlement([]), constrained.schema)).toMatchObject({ ok: true });
    expect(validateQualificationSchema(
      settlement([{ effectRef: "effect:A", claimedState: "in_progress" }]),
      constrained.schema,
    )).toMatchObject({ ok: true });
    expect(validateQualificationSchema(
      settlement([{ effectRef: "effect:B", claimedState: "in_progress" }]),
      constrained.schema,
    )).toMatchObject({ ok: false });
  });

  it("allows every member of a multi-effect namespace and rejects an outside reference", () => {
    const namespace = buildOperationalEffectNamespaceFromRefs(["effect:A", "effect:B"]);
    const constrained = constrainThoughtOutputSchema(namespace);

    expect(operationalSchema(constrained.schema).items.properties.effectRef.enum).toEqual([
      "effect:A",
      "effect:B",
    ]);
    expect(validateQualificationSchema(
      settlement([
        { effectRef: "effect:A", claimedState: "in_progress" },
        { effectRef: "effect:B", claimedState: "not_attempted" },
      ]),
      constrained.schema,
    )).toMatchObject({ ok: true });
    expect(validateQualificationSchema(
      settlement([{ effectRef: "effect:C", claimedState: "in_progress" }]),
      constrained.schema,
    )).toMatchObject({ ok: false });
  });

  it("normalizes incidental order and duplicate references before fingerprinting", () => {
    const first = buildOperationalEffectNamespaceFromRefs(["effect:B", "effect:A", "effect:A"]);
    const second = buildOperationalEffectNamespaceFromRefs(["effect:A", "effect:B"]);

    expect(first.allowedOperationalEffectRefs).toEqual(["effect:A", "effect:B"]);
    expect(first).toEqual(second);
    expect(constrainThoughtOutputSchema(first).schema).toEqual(
      constrainThoughtOutputSchema(second).schema,
    );
    expect(constrainThoughtOutputSchema(first).wireSchemaFingerprint).toBe(
      constrainThoughtOutputSchema(second).wireSchemaFingerprint,
    );
  });

  it("projects the exact constrained schema through the native NIM request body", () => {
    const request = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs([]),
    );
    const control: TrustedStructuredOutputControl = {
      kind: "native_json_schema",
      contractId: request.contractId,
      schemaId: request.schemaId,
      schemaFingerprint: request.schemaFingerprint,
      bindingId: "wire:nim-native-json-schema:v1",
      wireFormat: "nim_response_format_json_schema",
      schema: request.schema,
    };

    const body = buildNimRequestBody(
      [],
      { responseFormat: "json_schema", maxTokens: 128 },
      "nvidia/nemotron-3-super-120b-a12b",
      undefined,
      control,
    ) as SchemaRecord;

    expect(body.response_format.json_schema.schema).toEqual(request.schema);
    expect(body.response_format.json_schema.schema.oneOf[0].properties.commitments.properties.operational)
      .toBeUndefined();

    const nonEmptyRequest = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs(["effect:A", "effect:B"]),
    );
    const nonEmptyControl: TrustedStructuredOutputControl = {
      ...control,
      schemaFingerprint: nonEmptyRequest.schemaFingerprint,
      schema: nonEmptyRequest.schema,
    };
    const nonEmptyBody = buildNimRequestBody(
      [],
      { responseFormat: "json_schema", maxTokens: 128 },
      "nvidia/nemotron-3-super-120b-a12b",
      undefined,
      nonEmptyControl,
    ) as SchemaRecord;
    expect(nonEmptyBody.response_format.json_schema.schema.oneOf[0].properties.commitments.properties.operational)
      .toMatchObject({ items: { properties: { effectRef: { enum: ["effect:A", "effect:B"] } } } });
  });

  it("keeps semantic capability identity stable while separating dynamic wire identity", () => {
    const empty = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs([]),
    );
    const nonEmpty = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs(["effect:A"]),
    );

    expect(THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT).toBe(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT);
    expect(empty.schemaFingerprint).not.toBe(nonEmpty.schemaFingerprint);

    const common = {
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-super-120b-a12b",
      reasoningEffort: "high",
      maxTokens: 4096,
      responseFormat: "json_schema",
      structuredOutputContractId: "ashley.thought.semantic.v2",
      structuredOutputMode: "native_json_schema",
      structuredOutputBindingId: "wire:nim-native-json-schema:v1",
    } as const;
    expect(createInferencePolicyFingerprint({
      ...common,
      structuredOutputSchemaFingerprint: empty.schemaFingerprint,
    })).not.toBe(createInferencePolicyFingerprint({
      ...common,
      structuredOutputSchemaFingerprint: nonEmpty.schemaFingerprint,
    }));
  });
});

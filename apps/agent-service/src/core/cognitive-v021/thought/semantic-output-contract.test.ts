import { describe, expect, it } from "vitest";
import {
  THOUGHT_OUTPUT_SCHEMA,
  THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT,
  constrainThoughtOutputSchema,
  thoughtOutputCompatibilityInstruction,
  thoughtOutputStructuredRequest,
} from "./output-contract.js";
import { buildOperationalEffectNamespaceFromRefs } from "../effect/effect-ref.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { THOUGHT_OUTPUT_CONTRACT_ID, THOUGHT_OUTPUT_SCHEMA_ID } from "../../model-fabric/dispatch-contract.js";
import { IMPLEMENTATION_SPEC_VERSION, SETTLEMENT_SCHEMA_VERSION } from "../types.js";

const refs = new Set(["turn-1", "observation-1"]);

const settlement = {
  kind: "settlement",
  interpretation: {
    discourseActs: ["inform"],
    referentBindings: [{ span: "this", sourceTurnRefs: ["turn-1"] }],
    topics: ["testing"],
  },
  commitments: {
    conversational: ["answer"],
    stance: {
      warmth: "medium",
      humorAllowed: false,
      disagreement: false,
      uncertaintyDisplay: true,
    },
  },
  speech: {
    mode: "draft",
    mustSay: ["I can verify that."],
    surfaceDraft: "I can verify that.",
  },
  evidenceUse: {
    sourceRefsUsed: ["turn-1"],
  },
};

describe("Thought semantic output contract", () => {
  it("exposes the exact Sparse VNext release identities", () => {
    expect(SETTLEMENT_SCHEMA_VERSION).toBe(2);
    expect(IMPLEMENTATION_SPEC_VERSION).toBe("0.2.1.r6");
    expect(THOUGHT_OUTPUT_CONTRACT_ID).toBe("ashley.thought.semantic.v2");
    expect(THOUGHT_OUTPUT_SCHEMA_ID).toBe("ashley.thought.semantic.v2.schema");
  });

  it("accepts each of the four semantic branches", () => {
    expect(parseThoughtSemanticOutput(settlement, refs)).toMatchObject({ ok: true, value: { kind: "settlement" } });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "project.read_file",
      request: { path: "README.md" },
      purpose: "verify the project state",
      evidenceNeed: "the current file contents",
      existingRefs: ["turn-1"],
    }, refs)).toMatchObject({ ok: true, value: { kind: "observation_intent" } });
    expect(parseThoughtSemanticOutput({
      kind: "effect_intent",
      operationKind: "workspace.write_file",
      request: { path: "candidate.txt", content: "bounded" },
      purpose: "prepare the requested candidate",
      expectedOutcome: "a candidate file exists",
      existingRefs: ["turn-1"],
    }, refs)).toMatchObject({ ok: true, value: { kind: "effect_intent" } });
    expect(parseThoughtSemanticOutput({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "The current evidence is not enough.",
      evidenceRefs: ["turn-1"],
    }, refs)).toMatchObject({ ok: true, value: { kind: "abstain" } });
  });

  it("requires a non-empty surfaceDraft for draft speech across the parser and schema", () => {
    const missingSurfaceDraft = {
      ...settlement,
      speech: { ...settlement.speech },
    };
    delete (missingSurfaceDraft.speech as { surfaceDraft?: unknown }).surfaceDraft;

    expect(parseThoughtSemanticOutput(missingSurfaceDraft, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      ...settlement,
      speech: { ...settlement.speech, surfaceDraft: "" },
    }, refs)).toMatchObject({ ok: false });

    const request = thoughtOutputStructuredRequest();
    const schema = request.schema as {
      oneOf: Array<{
        properties?: {
          kind?: { const?: string };
          speech?: { oneOf?: Array<{ required?: string[]; properties?: Record<string, unknown> }> };
        };
      }>;
    };
    const settlementSchema = schema.oneOf.find((branch) => branch.properties?.kind?.const === "settlement");
    const draftSpeechSchema = settlementSchema?.properties?.speech?.oneOf?.find(
      (branch) => branch.properties?.mode && (branch.properties.mode as { const?: string }).const === "draft",
    );

    expect(draftSpeechSchema?.required).toContain("surfaceDraft");
    expect(draftSpeechSchema?.properties?.surfaceDraft).toMatchObject({ type: "string", minLength: 1 });
  });

  it("rejects model-authored mechanics, coercions, loose enums, and unknown fields", () => {
    for (const value of [
      { ...settlement, cycleId: "cycle-1" },
      { ...settlement, finalLicensedText: "model licensed this" },
      { ...settlement, authorityEpoch: 1 },
      { ...settlement, speech: { ...settlement.speech, mustSay: "one string" } },
      { ...settlement, commitments: { ...settlement.commitments, stance: { ...settlement.commitments.stance, humorAllowed: "false" } } },
      { ...settlement, interpretation: { ...settlement.interpretation, referentBindings: [{ span: "this", sourceTurnRefs: ["turn-1"], unexpected: true }] } },
      { kind: "abstain", reason: "INSUFFICIENT_EVIDENCE", explanation: "x", evidenceRefs: [] },
      { kind: "abstain", reason: "insufficient_evidence", explanation: "x", evidenceRefs: "turn-1" },
      { kind: "abstain", reason: "insufficient_evidence", explanation: "x", evidenceRefs: [], revisionCount: 1 },
      { kind: "observation_intent", operationKind: "PROJECT.READ_FILE", request: { path: "x" }, purpose: "x", evidenceNeed: "x", existingRefs: ["turn-1"] },
      { kind: "observation_intent", operationKind: "unregistered.operation", request: { path: "x" }, purpose: "x", evidenceNeed: "x", existingRefs: ["turn-1"] },
      { kind: "effect_intent", operationKind: "workspace.write_file", request: { path: "x" }, purpose: "x", expectedOutcome: "x", existingRefs: "turn-1" },
      { kind: "observation_intent", operationKind: "project.read_file", request: { path: "x" }, purpose: "x", evidenceNeed: "x", existingRefs: ["unknown"] },
    ]) {
      expect(parseThoughtSemanticOutput(value, refs)).toMatchObject({ ok: false });
    }
  });

  it("rejects fixed structural shapes that the native schema rejects", () => {
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "project.read_file",
      request: { path: "x" },
      purpose: "",
      evidenceNeed: "x",
      existingRefs: ["turn-1"],
    }, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      kind: "effect_intent",
      operationKind: "workspace.verify",
      request: { path: "x" },
      purpose: "x",
      expectedOutcome: "",
      existingRefs: ["turn-1"],
    }, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "",
      evidenceRefs: [],
    }, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      ...settlement,
      occupancyDeltas: [{
        op: "set",
        concernRef: { kind: "existing", ref: "turn-1" },
        status: "active",
        priority: 1.5,
      }],
    }, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      ...settlement,
      futureTriggerDeltas: [{
        op: "create",
        identity: { kind: "local", alias: "future-1" },
        concernRef: { kind: "existing", ref: "turn-1" },
        dueAtMs: 1.5,
        purpose: "check",
        payload: {},
      }],
    }, refs)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      ...settlement,
      subscriptionDeltas: [{
        op: "create",
        subscription: {
          identity: { kind: "local", alias: "subscription-1" },
          concernRef: null,
          source: "owner",
          scope: "qualification",
          topicKeys: [],
          match: "equality",
          expiresAtMs: 1.5,
        },
      }],
    }, refs)).toMatchObject({ ok: false });
  });

  it("attributes operation purpose and existing-reference failures to their owning fields", () => {
    const effect = {
      kind: "effect_intent",
      operationKind: "conversation.read",
      request: { conversationId: "qualification-conversation", turnId: "turn-1" },
      purpose: "read the requested conversation",
      expectedOutcome: "the requested conversation is available",
      existingRefs: ["turn-1"],
    };

    expect(parseThoughtSemanticOutput(effect, refs)).toEqual({
      ok: true,
      value: effect,
    });
    expect(parseThoughtSemanticOutput({ ...effect, purpose: "" }, refs)).toEqual({
      ok: false,
      code: "wrong_type",
      field: "purpose",
    });
    expect(parseThoughtSemanticOutput({ ...effect, existingRefs: ["qualification-conversation:turn-1"] }, refs)).toEqual({
      ok: false,
      code: "reference_not_allowlisted",
      field: "existingRefs",
    });
    expect(parseThoughtSemanticOutput({ ...effect, existingRefs: "turn-1" }, refs)).toEqual({
      ok: false,
      code: "wrong_type",
      field: "existingRefs",
    });
  });

  it("rejects the predecessor envelope and every kernel-owned identity field", () => {
    expect(parseThoughtSemanticOutput({
      kind: "settlement",
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      requestId: "request-1",
      occupantId: "occupant-1",
      settlement,
    }, refs)).toMatchObject({ ok: false });

    const kernelOwnedFields: Record<string, unknown> = {
      cycleId: "cycle-1",
      generation: 1,
      pass: 1,
      requestId: "request-1",
      occupantId: "occupant-1",
      authorityEpoch: 1,
      architectureEpoch: "v0.2.1",
      triggerRef: "turn-1",
      settlementId: "settlement-1",
      nuclearReservationId: "reservation-1",
      deliveryState: "pending",
    };
    for (const [field, value] of Object.entries(kernelOwnedFields)) {
      expect(parseThoughtSemanticOutput({ ...settlement, [field]: value }, refs), field)
        .toMatchObject({ ok: false });
    }
  });

  it("publishes the successor structured request with only the four semantic branches", () => {
    const request = thoughtOutputStructuredRequest();
    const schema = request.schema as {
      $id: string;
      oneOf: Array<{ properties?: Record<string, { const?: string }> }>;
    };

    expect(request.contractId).toBe("ashley.thought.semantic.v2");
    expect(request.schemaId).toBe("ashley.thought.semantic.v2.schema");
    expect(schema.$id).toBe("ashley.thought.semantic.v2.schema");
    expect(schema.oneOf.map((branch) => branch.properties?.kind?.const)).toEqual([
      "settlement",
      "observation_intent",
      "effect_intent",
      "abstain",
    ]);
    for (const branch of schema.oneOf) {
      expect(branch.properties).not.toHaveProperty("cycleId");
      expect(branch.properties).not.toHaveProperty("generation");
      expect(branch.properties).not.toHaveProperty("pass");
      expect(branch.properties).not.toHaveProperty("requestId");
      expect(branch.properties).not.toHaveProperty("occupantId");
    }
  });

  it("teaches Thought the semantic selection law separately from output shape", () => {
    const instruction = thoughtOutputCompatibilityInstruction();

    expect(instruction).toContain("Semantic selection rules");
    expect(instruction).toContain("settlement only when the current supplied evidence and context are sufficient");
    expect(instruction).toContain("observation_intent when the answer requires additional read-only evidence acquisition");
    expect(instruction).toContain("effect_intent when the requested outcome requires a governed mechanical effect");
    expect(instruction).toContain("abstain when required evidence, capability, or an admissible basis is absent or unresolved");
    expect(instruction).toContain("Do not use settlement as a placeholder for an unperformed observation or effect");
    expect(instruction).toContain('semanticClass:"observation" requires observation_intent');
    expect(instruction).toContain('semanticClass:"effect" requires effect_intent');
    expect(instruction).toContain("readOnly does not convert an effect-class operation into an observation");
    expect(instruction).toContain("workspace.verify");
    expect(instruction).toContain("Operational commitments are distinct from conversational continuation");
    expect(instruction).toContain("Every operational effectRef must refer to one of the complete Host-admitted operational effect references supplied in allowedOperationalEffectRefs");
    expect(instruction).toContain("If allowedOperationalEffectRefs is empty, omit commitments.operational");
    expect(instruction).toContain("This contract describes output shape only");
  });

  it("teaches Thought the speech.none intentional-silence boundary without Host forcing", () => {
    const instruction = thoughtOutputCompatibilityInstruction();

    // SPEECH_NONE_IS_INTENTIONAL_SILENCE
    expect(instruction).toContain("speech.mode:none means Ashley intentionally chooses not to communicate in this cycle");
    // NONE_IS_NOT_GENERIC_NOOP
    expect(instruction).toContain("it is not the generic no-op for a turn with no other work");
    // NO_STRUCTURED_UPDATE_DOES_NOT_IMPLY_SILENCE
    expect(instruction).toContain("does not by itself imply silence");
    // DRAFT_MAY_STAND_ALONE
    expect(instruction).toContain("a settlement may carry speech.mode:draft alone");
    // ORDINARY_CONVERSATION_IS_VALID_SPEECH_PURPOSE
    expect(instruction).toContain("ordinary conversation is itself a valid purpose for speech");
    // OWNER_BID_ORDINARILY_INVITES_PARTICIPATION
    expect(instruction).toContain("When the Owner directly addresses Ashley or makes a conversational bid");
    expect(instruction).toContain("participating is ordinarily a legitimate reason to speak even when no other update is required");
    // INTENTIONAL_SILENCE_REMAINS_VALID
    expect(instruction).toContain("silence remains fully valid when silence itself is the intended act");

    // NO_HOST_SIDE_SPEECH_FORCING: Thought stays sole semantic author.
    for (const forcing of ["must speak", "always reply", "never remain silent", "greetings require speech"]) {
      expect(instruction).not.toContain(forcing);
    }
    // PROVIDER_INDEPENDENT: no provider or model names in Thought semantics.
    for (const provider of ["cloudflare", "nemotron", "mistral", "groq"]) {
      expect(instruction.toLowerCase()).not.toContain(provider);
    }
  });

  it("teaches Thought that observation requires need-resolving relevance and abstain takes precedence", () => {
    const instruction = thoughtOutputCompatibilityInstruction();

    // OBSERVATION_REQUIRES_NEED_RESOLVING_RELEVANCE
    expect(instruction).toContain("only when an available observation can actually supply evidence capable of resolving the current semantic need");
    // UNRELATED_AVAILABLE_OBSERVATION_DOES_NOT_JUSTIFY_OBSERVATION
    expect(instruction).toContain("the availability of an unrelated observation does not justify observation");
    // ABSTAIN_PRECEDENCE_WHEN_NO_AVAILABLE_OBSERVATION_CAN_SUPPLY_NEEDED_EVIDENCE
    expect(instruction).toContain("when no available observation can supply the needed evidence, abstain takes precedence over observation");
  });

  it("teaches Thought the governed currentness rule Authority already enforces", () => {
    const instruction = thoughtOutputCompatibilityInstruction();

    // CURRENT_REQUIRES_GOVERNED_OBSERVATION
    expect(instruction).toContain("governed evidence status, not ordinary conversational recency");
    expect(instruction).toContain('Use time:current only for a factual claim whose present truth is supported by a governed observation supplied in the current Thought input');
    expect(instruction).toContain("evidenceUse.observationRefsUsed");
    // SOURCE_REF_ALONE_NOT_CURRENT
    expect(instruction).toContain("a source reference, a retrieval reference");
    expect(instruction).toContain("does not by itself license");
    // OWNER_RECENCY_NOT_CURRENT
    expect(instruction).toContain("the fact that the owner just sent a message does not by itself license");
    // UNKNOWN_FRESHNESS_DEFINED
    expect(instruction).toContain('Use time:unknown_freshness when evidence supports a claim but its present truth has not been established by governed current observation');
    // HISTORICAL_DEFINED
    expect(instruction).toContain('Use time:historical for a claim about a past state or event that does not assert it is still true now');
    // EPISTEMIC_COMMITMENT_MAY_BE_OMITTED_FOR_ACK
    expect(instruction).toContain("omit the epistemic commitment");
  });

  it("makes the canonical epistemic item shape explicit for json_object providers", () => {
    const instruction = thoughtOutputCompatibilityInstruction();

    expect(instruction).toContain("Every commitments.epistemic item must contain a dimensions object and a statement string");
    expect(instruction).toContain("dimensions must contain source, status, time, and reliability");
    expect(instruction).toContain("source, status, time, and reliability belong only inside dimensions");
    expect(instruction).toContain("MUST NOT place source, status, time, or reliability directly on the epistemic item");
    expect(instruction).toContain("surfaceSpan is optional");
    expect(instruction).toContain("observationRefs is optional");
    expect(instruction).toContain("Use only observation IDs actually supplied in the current Thought input");
  });

  it("rejects the exact malformed live B epistemic item shape", () => {
    const malformedLiveB = {
      kind: "settlement",
      speech: {
        mode: "draft",
        surfaceDraft: "I read 'online' as 'reachable again'.",
        mustSay: ["I read 'online' as 'reachable again'."],
      },
      commitments: {
        epistemic: [{
          surfaceSpan: "I read 'online' as 'reachable again'.",
          source: "ashley_interpretation",
          status: "interpreted",
        }],
      },
    };

    expect(parseThoughtSemanticOutput(malformedLiveB, new Set())).toEqual({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0]",
    });
  });

  it("rejects the exact malformed live C epistemic item shape", () => {
    const observationId = "f2-synthetic-observation-page-1";
    const malformedLiveC = {
      kind: "settlement",
      speech: {
        mode: "draft",
        surfaceDraft: "I read the page: the F2 qualification fixture marker is amber.",
        mustSay: ["I read the page: the F2 qualification fixture marker is amber."],
      },
      commitments: {
        epistemic: [{
          surfaceSpan: "I read the page: the F2 qualification fixture marker is amber.",
          source: "tool",
          status: "asserted",
          observationRefs: [observationId],
          time: "current",
        }],
      },
      evidenceUse: {
        observationRefsUsed: [observationId],
      },
    };

    expect(parseThoughtSemanticOutput(malformedLiveC, new Set([observationId]))).toEqual({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0]",
    });
  });

  it("accepts the canonical B interpretation equivalent", () => {
    const canonicalB = {
      kind: "settlement",
      speech: {
        mode: "draft",
        surfaceDraft: "I read 'online' as 'reachable again'.",
        mustSay: ["I read 'online' as 'reachable again'."],
      },
      commitments: {
        epistemic: [{
          dimensions: {
            source: "ashley_interpretation",
            status: "interpreted",
            time: "unknown_freshness",
            reliability: "inferred",
          },
          statement: "Ashley interprets the phrase as meaning reachable again.",
          surfaceSpan: "I read 'online' as 'reachable again'.",
        }],
      },
    };

    expect(parseThoughtSemanticOutput(canonicalB, new Set())).toEqual({
      ok: true,
      value: canonicalB,
    });
  });

  it("accepts the canonical C page-backed equivalent", () => {
    const observationId = "f2-synthetic-observation-page-1";
    const canonicalC = {
      kind: "settlement",
      speech: {
        mode: "draft",
        surfaceDraft: "I read the page: the F2 qualification fixture marker is amber.",
        mustSay: ["I read the page: the F2 qualification fixture marker is amber."],
      },
      commitments: {
        epistemic: [{
          dimensions: {
            source: "tool",
            status: "asserted",
            time: "current",
            reliability: "fallible_observation",
          },
          statement: "The page says the fixture marker is amber.",
          surfaceSpan: "I read the page: the F2 qualification fixture marker is amber.",
          observationRefs: [observationId],
        }],
      },
      evidenceUse: {
        observationRefsUsed: [observationId],
      },
    };

    expect(parseThoughtSemanticOutput(canonicalC, new Set([observationId]))).toEqual({
      ok: true,
      value: canonicalC,
    });
  });

  it("keeps protected semantic, wire, and capability fingerprints exact", () => {
    expect(THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT).toBe(
      "sha256:aae9ef734867d90fbc47dd5bdb78e06ca98912a01e7418347535fb8c6189390c",
    );
    const zeroOp = constrainThoughtOutputSchema(buildOperationalEffectNamespaceFromRefs([]));
    expect(zeroOp.wireSchemaFingerprint).toBe(
      "sha256:38c214779933925482d17d2041f237ef8cfc78b9c1106a10652d95beaf9341b6",
    );
    expect(zeroOp.namespaceConstraintFingerprint).toBe(
      "sha256:d277b3804b25361994107886d1f33f779a7501298b01fe483ebe7c795b6e19c6",
    );
  });

  it("binds per-claim surfaceSpan and observationRefs on epistemic commitments (F2)", () => {
    const schema = THOUGHT_OUTPUT_SCHEMA as {
      oneOf: Array<{ properties: { commitments: { properties: { epistemic: { items: {
        properties: Record<string, unknown>;
        required: string[];
      } } } } } }>;
    };
    const epistemicItems = schema.oneOf[0].properties.commitments.properties.epistemic.items;
    // Rotation is earned by the new optional binding fields, not a blind re-pin.
    expect(Object.keys(epistemicItems.properties).sort()).toEqual(
      ["dimensions", "observationRefs", "statement", "surfaceSpan"],
    );
    expect(epistemicItems.required).toEqual(["dimensions", "statement"]);
    expect(epistemicItems.properties.surfaceSpan).toMatchObject({ type: "string", minLength: 1 });
    expect(epistemicItems.properties.observationRefs).toMatchObject({
      type: "array",
      minItems: 1,
      items: { type: "string" },
    });
    const instruction = thoughtOutputCompatibilityInstruction();
    expect(instruction).toContain("surfaceSpan");
    expect(instruction).toContain("evidenceUse.observationRefsUsed");
    expect(instruction).toContain("source:ashley_interpretation");
  });

  it("carries semantic branch intent in the native schema without changing branch shape", () => {
    const request = thoughtOutputStructuredRequest();
    const schema = request.schema as {
      oneOf: Array<{ description?: string }>;
    };

    expect(schema.oneOf.map((branch) => branch.description)).toEqual([
      expect.stringContaining("current supplied evidence and context are sufficient"),
      expect.stringContaining("additional read-only evidence acquisition"),
      expect.stringContaining("governed mechanical effect"),
      expect.stringContaining("required evidence, capability, or an admissible basis is absent"),
    ]);
  });
});

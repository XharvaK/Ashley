import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { env } from "../../../env.js";
import type { completeChat as completeChatSignature } from "../../../mistral-client.js";
import {
  evaluateQualificationCase,
  diagnoseEffectIntentSemanticOutput,
  qualificationFixtureSettlementExpectation,
  replayCapturedQualificationFailure,
  runThoughtCapabilityQualification,
  qualificationFixtureOwnerMessage,
  thoughtSchemaKeywordInventory,
  validateQualificationSchema,
  validateThoughtOutputSchema,
  type QualificationGateEvidence,
  qualificationFixtureAbstainCoherence,
  normalizeInterLiveCaseDelayMs,
  MAX_INTER_LIVE_CASE_DELAY_MS,
} from "./thought-capability-qualification.js";
import { qualificationCheckoutIdentity } from "../../rollout/capabilities.js";
import { createThoughtStructuralFeedback } from "../thought/structural-feedback.js";
import { shouldAttemptQualificationStructuralCorrection } from "./thought-capability-qualification.js";

const validAbstain = JSON.stringify({
  kind: "abstain",
  reason: "insufficient_evidence",
  explanation: "The fixture contains no more evidence.",
  evidenceRefs: ["turn-1"],
});

const capturedEffectIntent = {
  kind: "effect_intent",
  operationKind: "conversation.read",
  request: {
    conversationId: "qualification-conversation",
    turnId: "turn-1",
    role: "owner",
    instruction: "Return the effect intent semantic branch without executing any effect.",
  },
  purpose: "To construct and return the effect intent semantic branch that satisfies the owner's qualification request without performing any actual effect operations",
  expectedOutcome: "A properly formatted effect_intent JSON object containing the semantic representation of the requested effect intent branch, demonstrating correct structural compliance with the semantic contract",
  existingRefs: ["qualification-conversation:turn-1"],
} as const;

const baseGate: QualificationGateEvidence = {
  transport: "success",
  provider: "cloudflare",
  model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
  kernelBinding: "PASS",
  fencing: "PASS",
  authorityReachability: "PASS",
  semanticValidity: "PASS",
  resourcePolicy: "PASS",
  elapsedMs: 1,
  outputTokens: 64,
  attempts: 1,
  maxOutputTokens: 16384,
  wireMode: "json_object_compatibility",
  wireBindingId: "compat_thought_cloudflare_deepseek_v4_flash_json_object_v1",
  providerDeclaredEnforcement: "unavailable",
  capabilityFingerprint: "sha256:" + "a".repeat(64),
  responseDiagnostics: {
    contentContainerType: "string",
    contentChunkTypes: [],
    textChunkCount: 0,
    thinkingChunkCount: 0,
    finalTextBytes: Buffer.byteLength(validAbstain, "utf8"),
    finishReason: "stop",
    finishReasonClass: "STOP",
    outputTokenLimit: 16384,
    outputTokens: 64,
    reasoningTokens: null,
    extractionFailure: "none",
  },
};

describe("successor Thought qualification", () => {
  it("passes every declared semantic branch through the real W0 fixture path", async () => {
    const result = await runThoughtCapabilityQualification({
      environment: "fixture",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      allowlistedReferences: ["turn-1"],
      runId: "w2-test-fixture",
    });
    expect(result.verdict).toBe("PASS");
    expect(result.cases.map((item) => item.caseId)).toEqual([
      "settlement",
      "observation_intent",
      "effect_intent",
      "abstain",
      "structural_correction",
    ]);
    expect(result.cases.every((item) =>
      item.transport === "success"
      && item.strictParser === "PASS"
      && item.kernelBinding === "PASS"
      && item.fencing === "PASS"
      && item.authorityReachability === "PASS"
      && item.semanticValidity === "PASS"
      && item.resourcePolicy === "PASS",
    )).toBe(true);
    expect(result.cases.find((item) => item.caseId === "structural_correction")?.invocationIds)
      .toHaveLength(2);
    expect(result.cases.find((item) => item.caseId === "structural_correction")?.correctionPackets)
      .toMatchObject([{
        attemptOrdinal: 2,
        attemptKind: "structural_correction",
        systemMessage: expect.stringContaining("reference_not_allowlisted"),
      }]);
    expect(result.cases.filter((item) => item.caseId !== "structural_correction")
      .every((item) => item.invocationIds.length === 1)).toBe(true);
    expect(result.negativeWitnesses?.map((item) => item.witness)).toContain(
      "provider-accepted structural value rejected by the W0 semantic parser",
    );
  });

  it("uses natural owner situations without leaking internal semantic branch names", () => {
    for (const caseId of ["settlement", "observation_intent", "effect_intent", "abstain"] as const) {
      const message = qualificationFixtureOwnerMessage(caseId);
      expect(message).not.toMatch(/settlement|observation_intent|effect_intent|abstain/i);
      expect(message).not.toMatch(/semantic branch/i);
    }
  });

  it("keeps the settlement fixture self-contained and its oracle supported by visible context", () => {
    expect(qualificationFixtureSettlementExpectation()).toEqual({
      ownerMessage: "Please acknowledge that you received this message.",
      expectedSpeech: "Got it.",
      sourceRefsUsed: ["turn-1"],
      selfContained: true,
      hiddenFactRequired: false,
      requiresObservation: false,
      requiresEffect: false,
      requiresUnavailableCapability: false,
      expectedSpeechSupportedByModelVisibleContext: true,
    });
  });

  it("keeps the abstain fixture coherent when project inspection is exposed", () => {
    expect(qualificationFixtureAbstainCoherence()).toEqual({
      ownerMessage: "Please tell me what is in the private attachment; no attachment content is available in this qualification context.",
      requiredEvidenceAbsent: true,
      attachmentPathAvailable: false,
      attachmentProjectBindingAvailable: false,
      availableAuthorizedObservationKinds: ["project.read_file"],
      relevantObservationKinds: [],
      authorizedObservationCanAcquireRelevantEvidence: false,
    });
  });

  it("proves default fixture mode performs no network call", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("fixture_network_forbidden");
    }) as typeof fetch;
    try {
      const result = await runThoughtCapabilityQualification({
        environment: "fixture",
        provider: "cloudflare",
        model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        allowlistedReferences: ["turn-1"],
        runId: "w2-test-no-network",
      });
      expect(result.verdict).toBe("PASS");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toBe(0);
  });

  it("derives the schema keyword inventory and fails closed on drift", () => {
    const inventory = thoughtSchemaKeywordInventory();
    expect(inventory).toEqual([
      "additionalProperties",
      "const",
      "enum",
      "items",
      "minItems",
      "minLength",
      "minProperties",
      "oneOf",
      "pattern",
      "properties",
      "required",
      "type",
    ]);
    const parsed = JSON.parse(validAbstain) as Record<string, unknown>;
    expect(validateThoughtOutputSchema(parsed).ok).toBe(true);
    expect(validateThoughtOutputSchema({ ...parsed, unexpected: true }).ok).toBe(false);
    expect(() => validateQualificationSchema({}, {
      type: "object",
      format: "unsupported",
    })).toThrow("thought_schema_oracle_unsupported_keyword:format");
  });

  it("fails each conjunct independently when its evidence is false", () => {
    const predicates = [
      "kernelBinding",
      "fencing",
      "authorityReachability",
      "semanticValidity",
      "resourcePolicy",
    ] as const;
    for (const predicate of predicates) {
      const result = evaluateQualificationCase({
        caseId: "abstain",
        rawContent: validAbstain,
        allowlistedReferences: ["turn-1"],
        gateEvidence: {
          ...baseGate,
          [predicate]: "FAIL",
        },
      });
      expect(result.verdict, predicate).toBe("NOT_QUALIFIED");
      expect(result.failureCodes.length, predicate).toBeGreaterThan(0);
    }
  });

  it("records a provider-accepted parser rejection as a negative witness", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: JSON.stringify({
        kind: "abstain",
        reason: "insufficient_evidence",
        explanation: "The reference is not in this allowlist.",
        evidenceRefs: ["turn-1"],
      }),
      allowlistedReferences: [],
    });
    expect(result.verdict).toBe("NOT_QUALIFIED");
    expect(result.failureCodes).toContain("PROVIDER_ACCEPTED_PARSER_REJECTED");
  });

  it("closes the captured effect-intent contradiction with an offline multi-fault diagnostic", async () => {
    const diagnostic = diagnoseEffectIntentSemanticOutput(capturedEffectIntent, ["turn-1"]);
    expect(diagnostic.staticSchema).toBe("PASS");
    expect(diagnostic.productionParser).toEqual({
      ok: false,
      code: "reference_not_allowlisted",
      field: "existingRefs",
    });
    expect(diagnostic.firstFailingCheck).toMatchObject({
      category: "contextual_reference",
      code: "reference_not_allowlisted",
      path: "existingRefs[0]",
    });
    expect(diagnostic.structuralViolations).toEqual([]);
    expect(diagnostic.contextualReferenceViolations).toEqual([{
      code: "reference_not_allowlisted",
      path: "existingRefs[0]",
      expected: "one of the host allowlisted reference IDs",
      actual: "qualification-conversation:turn-1",
    }]);
    expect(diagnostic.semanticViolationsAfterStructuralAcceptance).toBe("NOT_REACHED");

    const captured = evaluateQualificationCase({
      caseId: "effect_intent",
      expectedKind: "effect_intent",
      rawContent: JSON.stringify(capturedEffectIntent),
      allowlistedReferences: ["turn-1"],
      gateEvidence: {
        ...baseGate,
        dispatchTruth: "response_received",
        providerRequestStarted: true,
        providerResponseReceived: true,
        attemptId: "attempt:captured-effect-intent",
        responseDiagnostics: {
          ...baseGate.responseDiagnostics!,
          finalTextBytes: Buffer.byteLength(JSON.stringify(capturedEffectIntent), "utf8"),
        },
      },
    });
    expect(captured.firstFailureBoundary).toBe("STRICT_PARSER_REJECTION");
    expect(captured.failureEvidence?.strictParserDiagnostic).toMatchObject({
      parserErrorCode: "reference_not_allowlisted",
      parserPath: "existingRefs",
    });
    const replay = await replayCapturedQualificationFailure({
      caseId: "effect_intent",
      expectedKind: "effect_intent",
      capturedFirstFailureBoundary: captured.firstFailureBoundary,
      failureEvidence: captured.failureEvidence!,
      runId: "w2-offline-effect-intent-replay",
    });
    expect(replay).toMatchObject({
      available: true,
      normalizationMatched: true,
      sameFirstFailureBoundary: true,
      replayedFirstFailureBoundary: "STRICT_PARSER_REJECTION",
    });
  });

  it("keeps production parsing fail-fast while the diagnostic path reports independent faults", () => {
    const diagnostic = diagnoseEffectIntentSemanticOutput({
      ...capturedEffectIntent,
      purpose: "",
    }, ["turn-1"]);

    expect(diagnostic.productionParser).toEqual({
      ok: false,
      code: "wrong_type",
      field: "purpose",
    });
    expect(diagnostic.firstFailingCheck).toMatchObject({
      category: "structural",
      code: "wrong_type",
      path: "purpose",
    });
    expect(diagnostic.structuralViolations).toEqual([{
      code: "wrong_type",
      path: "purpose",
      expected: "non-empty string",
      actual: "empty string",
    }]);
    expect(diagnostic.contextualReferenceViolations).toEqual([{
      code: "reference_not_allowlisted",
      path: "existingRefs[0]",
      expected: "one of the host allowlisted reference IDs",
      actual: "qualification-conversation:turn-1",
    }]);
    expect(diagnostic.semanticViolationsAfterStructuralAcceptance).toBe("NOT_REACHED");
  });

  it("does not project parser-dependent gates as failures", () => {
    const rawContent = JSON.stringify({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "The fixture contains no more evidence.",
      evidenceRefs: ["turn-1"],
    });
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent,
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        dispatchTruth: "response_received",
        providerRequestStarted: true,
        providerResponseReceived: true,
        attemptId: "attempt:parser-boundary",
      },
    });

    expect(result.jsonSyntax).toBe("PASS");
    expect(result.closedSchemaConformance).toBe("PASS");
    expect(result.strictParser).toBe("FAIL");
    expect(result.kernelBinding).toBe("NOT_REACHED");
    expect(result.semanticValidity).toBe("NOT_REACHED");
    expect(result.fencing).toBe("NOT_REACHED");
    expect(result.authorityReachability).toBe("NOT_REACHED");
    expect(result.resourcePolicy).toBe("PASS");
    expect(result.diagnostics.firstFailureBoundary).toBe("STRICT_PARSER_REJECTION");
    expect(result.independentFailureCodes).toEqual(["PROVIDER_ACCEPTED_PARSER_REJECTED"]);
    expect(result.dependentNotReachedGates).toEqual([
      "kernelBinding",
      "semanticValidity",
      "fencing",
      "authorityReachability",
    ]);
    expect(result.failureEvidence?.captureStatus).toBe("captured");
    expect(result.failureEvidence?.normalizedSemanticText).toBe(rawContent);
    expect(result.failureEvidence?.strictParserDiagnostic).toMatchObject({
      parserErrorCode: "reference_not_allowlisted",
      parserPath: "evidenceRefs",
    });
    expect(result.failureCodes).not.toContain("kernelBinding_failed");
    expect(result.failureCodes).not.toContain("fencing_failed");
    expect(result.failureCodes).not.toContain("authorityReachability_failed");
  });

  it("stops causal reachability at semantic validity", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: validAbstain,
      allowlistedReferences: ["turn-1"],
      gateEvidence: {
        ...baseGate,
        semanticValidity: "FAIL",
      },
    });

    expect(result.semanticValidity).toBe("FAIL");
    expect(result.fencing).toBe("NOT_REACHED");
    expect(result.authorityReachability).toBe("NOT_REACHED");
    expect(result.diagnostics.firstFailureBoundary).toBe("SEMANTIC_VALIDITY_REJECTION");
    expect(result.independentFailureCodes).toContain("semantic_invalid");
    expect(result.failureCodes).not.toContain("fencing_failed");
    expect(result.failureCodes).not.toContain("authorityReachability_failed");
  });

  it("stops authority evaluation at a fencing failure", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: validAbstain,
      allowlistedReferences: ["turn-1"],
      gateEvidence: {
        ...baseGate,
        fencing: "FAIL",
      },
    });

    expect(result.kernelBinding).toBe("PASS");
    expect(result.semanticValidity).toBe("PASS");
    expect(result.fencing).toBe("FAIL");
    expect(result.authorityReachability).toBe("NOT_REACHED");
    expect(result.diagnostics.firstFailureBoundary).toBe("FENCING_REJECTION");
    expect(result.independentFailureCodes).toContain("fencing_failed");
    expect(result.failureCodes).not.toContain("authorityReachability_failed");
  });

  it("keeps an empty pre-dispatch capture outside provider reliability", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: "",
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        transport: "failure",
        provider: undefined,
        model: undefined,
        kernelBinding: "NOT_REACHED",
        fencing: "NOT_REACHED",
        authorityReachability: "NOT_REACHED",
        semanticValidity: "NOT_REACHED",
        resourcePolicy: "NOT_REACHED",
        dispatchTruth: "not_sent",
        dispatchStage: "attention_admission",
        providerRequestStarted: false,
        providerResponseReceived: false,
        attemptId: null,
        errorCode: "request_exceeds_tpm_budget",
      },
    });

    expect(result.diagnostics.firstFailureBoundary).toBe("PRE_DISPATCH_LOCAL_FAILURE");
    expect(result.jsonSyntax).toBe("NOT_REACHED");
    expect(result.closedSchemaConformance).toBe("NOT_REACHED");
    expect(result.strictParser).toBe("NOT_REACHED");
    expect(result.kernelBinding).toBe("NOT_REACHED");
    expect(result.semanticValidity).toBe("NOT_REACHED");
    expect(result.fencing).toBe("NOT_REACHED");
    expect(result.authorityReachability).toBe("NOT_REACHED");
    expect(result.resourcePolicy).toBe("NOT_REACHED");
    expect(result.providerAttemptIds).toEqual([]);
    expect(result.failureCodes).not.toContain("provider_dispatch_failed");
    expect(result.failureEvidence?.captureStatus).toBe("not_applicable");
  });

  it("fails closed when normalized failed content exceeds the evidence ceiling", () => {
    const rawContent = JSON.stringify({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "x".repeat(33_000),
      evidenceRefs: [],
    });
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent,
      allowlistedReferences: [],
      gateEvidence: baseGate,
    });

    expect(result.verdict).toBe("NOT_QUALIFIED");
    expect(result.failureEvidence?.captureStatus).toBe("diagnostic_capture_too_large");
    expect(result.failureEvidence?.normalizedSemanticText).toBeNull();
    expect(result.failureEvidence?.normalizedSemanticBytes).toBeGreaterThan(32_768);
    expect(result.failureCodes).toContain("diagnostic_capture_too_large");
  });

  it("replays captured parser failure through the offline W0 path", async () => {
    const rawContent = JSON.stringify({
      kind: "abstain",
      reason: "insufficient_evidence",
      explanation: "The provider selected a reference that was not supplied.",
      evidenceRefs: ["unknown-reference"],
    });
    const captured = evaluateQualificationCase({
      caseId: "abstain",
      expectedKind: "abstain",
      rawContent,
      allowlistedReferences: ["turn-1"],
      gateEvidence: {
        ...baseGate,
        dispatchTruth: "response_received",
        providerRequestStarted: true,
        providerResponseReceived: true,
        attemptId: "attempt:offline-replay",
        responseDiagnostics: {
          ...baseGate.responseDiagnostics!,
          finalTextBytes: Buffer.byteLength(rawContent, "utf8"),
        },
      },
    });
    expect(captured.failureEvidence).not.toBeNull();
    expect(captured.failureEvidence?.providerContentChunkMetadata).toMatchObject({
      contentContainerType: "string",
      finalTextBytes: Buffer.byteLength(rawContent, "utf8"),
      extractionFailure: "none",
    });
    const replay = await replayCapturedQualificationFailure({
      caseId: "abstain",
      expectedKind: "abstain",
      capturedFirstFailureBoundary: captured.firstFailureBoundary,
      failureEvidence: captured.failureEvidence!,
      runId: "w2-offline-parser-replay",
    });

    expect(replay.available).toBe(true);
    expect(replay.normalizationMatched).toBe(true);
    expect(replay.sameFirstFailureBoundary).toBe(true);
    expect(replay.replayedFirstFailureBoundary).toBe("STRICT_PARSER_REJECTION");
    expect(replay.replayedCase?.kernelBinding).toBe("NOT_REACHED");
    expect(replay.replayedCase?.fencing).toBe("NOT_REACHED");
    expect(replay.replayedCase?.authorityReachability).toBe("NOT_REACHED");
  });

  it("retains precise closed-schema diagnostics without persisting provider content", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: JSON.stringify({ kind: "unknown", explanation: "not a permitted branch" }),
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        dispatchTruth: "response_received",
        dispatchStage: "provider_dispatch",
        providerRequestStarted: true,
        providerResponseReceived: true,
        attemptId: "attempt:provider-content",
      },
    });

    expect(result.diagnostics.firstFailureBoundary).toBe("LOCAL_SCHEMA_REJECTION");
    expect(result.diagnostics.closedSchemaFailureKeyword).toBe("oneOf");
    expect(result.diagnostics.closedSchemaFailureInstancePath).toBe("$");
    expect(result.diagnostics.closedSchemaFailureSchemaPath).toBe("#/oneOf");
    expect(result.diagnostics.dispatchTruth).toBe("response_received");
    expect(result.diagnostics.providerRequestStarted).toBe(true);
    expect(result.diagnostics.providerResponseReceived).toBe(true);
    expect(result.diagnostics.attemptId).toBe("attempt:provider-content");
    expect(result.diagnostics.reachability).toEqual({
      kernelBinding: "NOT_REACHED",
      fencing: "NOT_REACHED",
      authorityReachability: "NOT_REACHED",
      semanticValidity: "NOT_REACHED",
    });
    expect("rawContent" in result).toBe(false);
    expect(result.rawContentBytes).toBeGreaterThan(0);
  });

  it("classifies a local pre-dispatch failure without claiming provider reliability", () => {
    const result = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: "",
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        transport: "failure",
        provider: undefined,
        model: undefined,
        kernelBinding: "NOT_REACHED",
        fencing: "NOT_REACHED",
        authorityReachability: "NOT_REACHED",
        semanticValidity: "NOT_REACHED",
        resourcePolicy: "NOT_REACHED",
        dispatchTruth: "not_sent",
        dispatchStage: "attention_admission",
        providerRequestStarted: false,
        providerResponseReceived: false,
        attemptId: null,
        errorCode: "request_exceeds_tpm_budget",
      },
    });

    expect(result.diagnostics.firstFailureBoundary).toBe("PRE_DISPATCH_LOCAL_FAILURE");
    expect(result.diagnostics.dispatchTruth).toBe("not_sent");
    expect(result.diagnostics.providerRequestStarted).toBe(false);
    expect(result.diagnostics.providerResponseReceived).toBe(false);
    expect(result.diagnostics.errorCode).toBe("request_exceeds_tpm_budget");
    expect(result.diagnostics.reachability).toEqual({
      kernelBinding: "NOT_REACHED",
      fencing: "NOT_REACHED",
      authorityReachability: "NOT_REACHED",
      semanticValidity: "NOT_REACHED",
    });
  });

  it("distinguishes a dispatched attempt with no response from a provider error response", () => {
    const noResponse = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: "",
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        transport: "failure",
        dispatchTruth: "sent_outcome_unknown",
        dispatchStage: "provider_dispatch",
        providerRequestStarted: true,
        providerResponseReceived: false,
        attemptId: "attempt:no-response",
        errorCode: "timeout",
      },
    });
    const providerError = evaluateQualificationCase({
      caseId: "abstain",
      rawContent: "",
      allowlistedReferences: [],
      gateEvidence: {
        ...baseGate,
        transport: "failure",
        dispatchTruth: "response_received",
        dispatchStage: "provider_dispatch",
        providerRequestStarted: true,
        providerResponseReceived: true,
        attemptId: "attempt:provider-error",
        errorCode: "provider_unavailable",
      },
    });

    expect(noResponse.diagnostics.firstFailureBoundary).toBe("REQUEST_DISPATCHED_NO_RESPONSE");
    expect(providerError.diagnostics.firstFailureBoundary).toBe("PROVIDER_ERROR_RESPONSE");
    expect(noResponse.diagnostics.attemptId).toBe("attempt:no-response");
    expect(providerError.diagnostics.attemptId).toBe("attempt:provider-error");
  });

  it("does not localize a settlement parser field when qualification expects observation", () => {
    const feedback = createThoughtStructuralFeedback({
      code: "wrong_type",
      field: "evidenceUse",
      previousCandidate: JSON.stringify({
        kind: "settlement",
        evidenceUse: { observationRefsUsed: "not-an-array" },
      }),
    });

    expect(feedback.correctionScope).toBe("localized");
    expect(shouldAttemptQualificationStructuralCorrection({
      expectedKind: "observation_intent",
      structuralFeedback: feedback,
    })).toBe(false);
    expect(shouldAttemptQualificationStructuralCorrection({
      expectedKind: "settlement",
      structuralFeedback: feedback,
    })).toBe(true);
  });

  it("rejects a stale production release label before isolated live dispatch", async () => {
    const checkoutIdentity = qualificationCheckoutIdentity();
    const staleReleaseIdentity = checkoutIdentity === "a".repeat(40)
      ? "b".repeat(40)
      : "a".repeat(40);
    const originalReleaseIdentity = env.ashleyReleaseId;
    let completeChatCalls = 0;
    env.ashleyReleaseId = staleReleaseIdentity;
    try {
      const result = await runThoughtCapabilityQualification({
        environment: "isolated_live",
        provider: "cloudflare",
        model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        candidateSha: checkoutIdentity,
        allowlistedReferences: [],
        noFallback: true,
        completeChat: async () => {
          completeChatCalls += 1;
          throw new Error("network_must_not_start");
        },
      });
      expect(result.verdict).toBe("NOT_RUN");
      expect(result.preflight).toMatchObject({
        errorCode: "qualification_release_identity_mismatch",
      });
      expect(completeChatCalls).toBe(0);
    } finally {
      env.ashleyReleaseId = originalReleaseIdentity;
    }
  });

  it("refuses silent route substitution", async () => {
    const result = await runThoughtCapabilityQualification({
      environment: "fixture",
      provider: "groq",
      model: "openai/gpt-oss-20b",
      allowlistedReferences: [],
    });
    expect(result.verdict).toBe("NOT_QUALIFIED");
    expect(result.cases).toHaveLength(0);
  });
});

type PacingEvent =
  | { kind: "now-read"; value: number }
  | { kind: "sleep"; delayMs: number }
  | { kind: "provider-call"; atMs: number };

/**
 * Deterministic W2 campaign-pacing harness. The fake clock advances ONLY
 * inside the injected sleeper, so every timestamp the qualification code
 * reads after a sleep (including the next case's Thought deadline seed)
 * provably postdates the completed delay. No test sleeps real time and no
 * test calls a live provider.
 */
function createPacingHarness() {
  const events: PacingEvent[] = [];
  let now = 1_700_000_000_000;
  const nowMs = () => {
    events.push({ kind: "now-read", value: now });
    return now;
  };
  const sleepMs = async (ms: number) => {
    events.push({ kind: "sleep", delayMs: ms });
    now += ms;
  };
  const fakeCompletion = {
    text: validAbstain,
        model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        modelAlias: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        resolvedModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    usage: { promptTokens: 128, completionTokens: 64 },
    finishReason: "stop",
    responseDiagnostics: null,
    capturedAttemptIdentity: null,
    wireEvidence: null,
    capabilityIdentity: null,
  } as unknown as Awaited<ReturnType<typeof completeChatSignature>>;
  let providerCalls = 0;
  const completeChat = (async () => {
    providerCalls += 1;
    events.push({ kind: "provider-call", atMs: nowMs() });
    return fakeCompletion;
  }) as unknown as typeof completeChatSignature;
  return { events, nowMs, sleepMs, completeChat, providerCallCount: () => providerCalls };
}

async function runIsolatedLiveForPacing(input: {
  caseIds?: readonly ("settlement" | "observation_intent" | "effect_intent" | "abstain")[];
  samples?: number;
  interLiveCaseDelayMs?: number;
  harness?: ReturnType<typeof createPacingHarness>;
  runId?: string;
}) {
  const harness = input.harness ?? createPacingHarness();
  const checkoutIdentity = qualificationCheckoutIdentity();
  const savedRelease = env.ashleyReleaseId;
  const savedCloudflareToken = env.cloudflareApiToken;
  const savedCloudflareAccount = env.cloudflareAccountId;
  env.ashleyReleaseId = checkoutIdentity;
  env.cloudflareApiToken = "pacing-test-token";
  env.cloudflareAccountId = "pacing-test-account";
  const outputDir = join(tmpdir(), `w2-pacing-${randomUUID()}`);
  try {
    const result = await runThoughtCapabilityQualification({
      environment: "isolated_live",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      candidateSha: checkoutIdentity,
      allowlistedReferences: ["turn-1"],
      noFallback: true,
      runId: input.runId ?? `w2-test-pacing-${randomUUID()}`,
      outputDir,
      caseIds: input.caseIds,
      samples: input.samples,
      interLiveCaseDelayMs: input.interLiveCaseDelayMs,
      completeChat: harness.completeChat,
      nowMs: harness.nowMs,
      sleepMs: harness.sleepMs,
    });
    return { result, harness };
  } finally {
    env.ashleyReleaseId = savedRelease;
    env.cloudflareApiToken = savedCloudflareToken;
    env.cloudflareAccountId = savedCloudflareAccount;
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function sleepEventsOf(events: readonly PacingEvent[]): number[] {
  return events.filter((event) => event.kind === "sleep").map((event) => event.delayMs);
}

describe("w2 campaign pacing repair", () => {
  it("fails closed on invalid pacing values and defaults an absent value to 0", () => {
    expect(normalizeInterLiveCaseDelayMs(undefined)).toBe(0);
    expect(normalizeInterLiveCaseDelayMs(0)).toBe(0);
    expect(normalizeInterLiveCaseDelayMs(65000)).toBe(65000);
    expect(normalizeInterLiveCaseDelayMs("65000")).toBe(65000);
    expect(normalizeInterLiveCaseDelayMs(MAX_INTER_LIVE_CASE_DELAY_MS))
      .toBe(MAX_INTER_LIVE_CASE_DELAY_MS);
    for (const invalid of [-1, 1.5, Number.NaN, "pacing", true, false, null, {}, []]) {
      expect(() => normalizeInterLiveCaseDelayMs(invalid)).toThrow("inter_live_case_delay_invalid");
    }
    expect(() => normalizeInterLiveCaseDelayMs(MAX_INTER_LIVE_CASE_DELAY_MS + 1))
      .toThrow("inter_live_case_delay_invalid");
  });

  it("rejects an invalid pacing delay before isolated live dispatch", async () => {
    let completeChatCalls = 0;
    const result = await runThoughtCapabilityQualification({
      environment: "isolated_live",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      allowlistedReferences: [],
      noFallback: true,
      interLiveCaseDelayMs: -1,
      completeChat: (async () => {
        completeChatCalls += 1;
        throw new Error("network_must_not_start");
      }) as unknown as typeof completeChatSignature,
    });
    expect(result.verdict).toBe("NOT_RUN");
    expect(result.preflight).toMatchObject({ errorCode: "inter_live_case_delay_invalid" });
    expect(completeChatCalls).toBe(0);
  });

  it("waits between live cases only after the previous case completes", async () => {
    const { result, harness } = await runIsolatedLiveForPacing({
      caseIds: ["settlement", "abstain"],
      samples: 1,
      interLiveCaseDelayMs: 65000,
    });
    expect(result.cases).toHaveLength(2);
    // Exactly one inter-case wait for two cases: the first case runs with no pre-delay.
    expect(sleepEventsOf(harness.events)).toEqual([65000]);
    const firstSleepIndex = harness.events.findIndex((event) => event.kind === "sleep");
    const firstProviderIndex = harness.events.findIndex((event) => event.kind === "provider-call");
    expect(firstProviderIndex).toBeGreaterThanOrEqual(0);
    expect(firstSleepIndex).toBeGreaterThan(firstProviderIndex);
    // The second case's provider call happens only after the wait completes.
    const providerIndices = harness.events
      .map((event, index) => (event.kind === "provider-call" ? index : -1))
      .filter((index) => index >= 0);
    expect(providerIndices.length).toBeGreaterThanOrEqual(2);
    expect(providerIndices[providerIndices.length - 1]).toBeGreaterThan(firstSleepIndex);
    // Pacing configuration is recorded as campaign metadata, not a verdict input.
    expect(result.campaign).toEqual({ interLiveCaseDelayMs: 65000 });
    for (const item of result.cases) {
      expect(["PASS", "NOT_QUALIFIED"]).toContain(item.verdict);
    }
  });

  it("proves the next request deadline starts only after the delay completes", async () => {
    const { result, harness } = await runIsolatedLiveForPacing({
      caseIds: ["settlement", "observation_intent"],
      samples: 1,
      interLiveCaseDelayMs: 65000,
    });
    expect(result.cases).toHaveLength(2);
    // The fake clock advances only inside the injected sleeper, so scanning
    // the event log in order proves every timestamp read after a sleep —
    // including the next case's Thought deadline seed — postdates the delay.
    let expectedNow = 1_700_000_000_000;
    let sleepsSeen = 0;
    for (const event of harness.events) {
      if (event.kind === "sleep") {
        expect(event.delayMs).toBe(65000);
        expectedNow += event.delayMs;
        sleepsSeen += 1;
      } else if (event.kind === "now-read") {
        expect(event.value).toBe(expectedNow);
      } else {
        expect(event.atMs).toBe(expectedNow);
      }
    }
    expect(sleepsSeen).toBe(1);
  });

  it("defaults to zero delay and preserves unpaced live behavior", async () => {
    const { result, harness } = await runIsolatedLiveForPacing({
      caseIds: ["settlement", "abstain"],
      samples: 1,
    });
    expect(result.cases).toHaveLength(2);
    expect(sleepEventsOf(harness.events)).toEqual([]);
    expect(harness.providerCallCount()).toBeGreaterThan(0);
    expect(result.campaign).toEqual({ interLiveCaseDelayMs: 0 });
  });

  it("keeps one 12-case campaign with the PASS oracle unchanged", async () => {
    const runId = `w2-test-pacing-full-${randomUUID()}`;
    const { result, harness } = await runIsolatedLiveForPacing({
      samples: 3,
      interLiveCaseDelayMs: 65000,
      runId,
    });
    expect(result.runId).toBe(runId);
    expect(result.cases.map((item) => item.caseId)).toEqual([
      "settlement", "settlement", "settlement",
      "observation_intent", "observation_intent", "observation_intent",
      "effect_intent", "effect_intent", "effect_intent",
      "abstain", "abstain", "abstain",
    ]);
    // Eleven inter-case waits for twelve cases in a single campaign artifact.
    expect(sleepEventsOf(harness.events)).toHaveLength(11);
    expect(sleepEventsOf(harness.events).every((delayMs) => delayMs === 65000)).toBe(true);
    // The canned wrong-kind responses still fail the unchanged oracle; pacing
    // schedules samples but never converts a failure into a PASS.
    for (const item of result.cases) {
      expect(["PASS", "NOT_QUALIFIED"]).toContain(item.verdict);
    }
    expect(result.cases.some((item) => item.verdict === "NOT_QUALIFIED")).toBe(true);
    expect(result.verdict).toBe("NOT_QUALIFIED");
    expect(result.campaign).toEqual({ interLiveCaseDelayMs: 65000 });
  });

  it("leaves the fixture path unpaced and its artifact shape unchanged", async () => {
    const harness = createPacingHarness();
    const result = await runThoughtCapabilityQualification({
      environment: "fixture",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      allowlistedReferences: ["turn-1"],
      runId: "w2-test-pacing-fixture",
      interLiveCaseDelayMs: 65000,
      nowMs: harness.nowMs,
      sleepMs: harness.sleepMs,
    });
    expect(result.verdict).toBe("PASS");
    expect(sleepEventsOf(harness.events)).toEqual([]);
    expect("campaign" in result).toBe(false);
  });
});

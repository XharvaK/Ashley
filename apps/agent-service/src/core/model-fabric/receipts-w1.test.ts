import { describe, expect, it } from "vitest";
import { createContextProjection } from "./projection.js";
import { createModelFabricInvocation, modelFailureFor } from "./receipts.js";
import { buildThoughtCapabilityIdentity } from "./capability-identity.js";

describe("W1 attempt attribution", () => {
  it("persists capability fingerprint and sanitized wire evidence on the exact attempt", () => {
    const projection = createContextProjection({
      purpose: "thought",
      contextPolicyId: "thought_summary",
      messages: [{ role: "user", content: "private content" }],
    });
    const fabric = createModelFabricInvocation({
      logicalRole: "thought",
      requestedPurpose: "thought",
      specialistRequirement: null,
      fallbackChain: null,
      projection,
    });
    const capability = buildThoughtCapabilityIdentity({
      executableBuildIdentity: "build:fixture",
      semanticContractFingerprint: "sha256:" + "a".repeat(64),
      kernelEnvelopeContractVersion: "ashley.thought.kernel-envelope.v1",
      parserValidatorFingerprint: "sha256:" + "b".repeat(64),
      provider: "nim",
      configuredModelId: "openai/gpt-oss-20b",
      occupantId: "nim-primary",
      logicalBindingId: "logical:thought:v1",
      wireBindingId: "wire:nim-json-object",
      schemaEnforcementMode: "json_object_compatibility",
      resourcePolicyFingerprint: "sha256:" + "c".repeat(64),
      adapterCompatibilityFingerprint: "sha256:" + "d".repeat(64),
    });
    const attempt = fabric.beginAttempt({
      invocationId: fabric.invocationId,
      attemptId: `${fabric.invocationId}:attempt:1`,
      attemptOrdinal: 1,
      fallbackFromAttemptId: null,
      fallbackClass: "none",
      facts: {
        dispatchedRouteId: "thought" as never,
        registryVersion: "fixture",
        profileId: "profile:fixture" as never,
        profileVersion: 1 as never,
        profileFingerprint: "sha256:" + "e".repeat(64) as never,
        provider: "nim" as never,
        configuredModelId: "openai/gpt-oss-20b",
        contextPolicyId: "thought_summary" as never,
        admissionBasis: { kind: "existing_compatibility", compatibilityBindingId: "fixture" },
        requestedReasoningPolicy: null,
        effectiveReasoning: null,
        translatedWireControl: null,
        inferencePolicyFingerprint: null,
        structuredOutputSchemaFingerprint: null,
      },
      projection,
      backend: "nim",
      requestedReasoningPolicy: null,
      effectiveReasoningSent: null,
      translatedWireControl: null,
    });
    attempt.markDispatchAttempted();
    attempt.setWireEvidence({
      adapterId: "ashley.adapter.nim.v1",
      wireFormat: "json_object",
      sanitizedBodyDigest: "sha256:" + "f".repeat(64) as `sha256:${string}`,
      emittedEnforcementMode: "json_object_compatibility",
      providerDeclaredEnforcement: "unavailable",
      bindingId: "wire:nim-json-object",
    });
    attempt.setCapabilityIdentity(capability);

    const receipt = attempt.receipt();
    expect(receipt).toMatchObject({
      capabilityFingerprint: capability.fingerprint,
      wireEvidence: {
        adapterId: "ashley.adapter.nim.v1",
        sanitizedBodyDigest: "sha256:" + "f".repeat(64),
      },
    });
  });

  it("propagates cached provider input tokens into the model usage receipt", () => {
    const projection = createContextProjection({
      purpose: "thought",
      contextPolicyId: "thought_summary",
      messages: [{ role: "user", content: "private content" }],
    });
    const fabric = createModelFabricInvocation({
      logicalRole: "thought",
      requestedPurpose: "thought",
      specialistRequirement: null,
      fallbackChain: null,
      projection,
    });
    const attempt = fabric.beginAttempt({
      invocationId: fabric.invocationId,
      attemptId: `${fabric.invocationId}:attempt:1`,
      attemptOrdinal: 1,
      fallbackFromAttemptId: null,
      fallbackClass: "none",
      facts: {} as never,
      projection,
      backend: "fixture",
      requestedReasoningPolicy: null,
      effectiveReasoningSent: null,
    });

    attempt.markDispatchAttempted();
    attempt.markProviderResponse({
      resolvedModelId: "fixture-model",
      usage: { promptTokens: 20, completionTokens: 3, cachedTokens: 7 },
    });

    expect(attempt.receipt()).toMatchObject({
      usage: {
        inputTokens: 20,
        outputTokens: 3,
        cachedInputTokens: 7,
        reasoningTokens: null,
        providerReported: true,
      },
    });
  });

  it("keeps cached provider input tokens null when the provider omits the field", () => {
    const projection = createContextProjection({
      purpose: "thought",
      contextPolicyId: "thought_summary",
      messages: [{ role: "user", content: "private content" }],
    });
    const fabric = createModelFabricInvocation({
      logicalRole: "thought",
      requestedPurpose: "thought",
      specialistRequirement: null,
      fallbackChain: null,
      projection,
    });
    const attempt = fabric.beginAttempt({
      invocationId: fabric.invocationId,
      attemptId: `${fabric.invocationId}:attempt:1`,
      attemptOrdinal: 1,
      fallbackFromAttemptId: null,
      fallbackClass: "none",
      facts: {} as never,
      projection,
      backend: "fixture",
      requestedReasoningPolicy: null,
      effectiveReasoningSent: null,
    });

    attempt.markDispatchAttempted();
    attempt.markProviderResponse({
      resolvedModelId: "fixture-model",
      usage: { promptTokens: 20, completionTokens: 3 },
    });

    expect(attempt.receipt()).toMatchObject({
      usage: {
        inputTokens: 20,
        outputTokens: 3,
        cachedInputTokens: null,
      },
    });
  });

  it("records provider HTTP status only on provider response receipts", () => {
    const projection = createContextProjection({
      purpose: "thought",
      contextPolicyId: "thought_summary",
      messages: [{ role: "user", content: "status fixture" }],
    });
    const fabric = createModelFabricInvocation({
      logicalRole: "thought",
      requestedPurpose: "thought",
      specialistRequirement: null,
      fallbackChain: null,
      projection,
    });
    const attempt = fabric.beginAttempt({
      invocationId: fabric.invocationId,
      attemptId: `${fabric.invocationId}:attempt:1`,
      attemptOrdinal: 1,
      fallbackFromAttemptId: null,
      fallbackClass: "none",
      facts: {} as never,
      projection,
      backend: "nim",
      requestedReasoningPolicy: null,
      effectiveReasoningSent: null,
    });

    expect(attempt.receipt()).not.toHaveProperty("providerHttpStatus");
    attempt.markDispatchAttempted();
    expect(attempt.receipt()).not.toHaveProperty("providerHttpStatus");
    attempt.markProviderResponse({
      resolvedModelId: "fixture-model",
      providerHttpStatus: 503,
    });
    expect(attempt.receipt()).toMatchObject({
      receiptStage: "provider_response",
      dispatchTruth: "response_received",
      providerHttpStatus: 503,
    });
  });

  it("classifies a raw deadline TimeoutError as timeout, never configuration_error", () => {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    expect(modelFailureFor(error, "provider_dispatch", "sent_outcome_unknown")).toMatchObject({
      code: "timeout",
      dispatchTruth: "sent_outcome_unknown",
      retryability: "caller_may_retry",
    });
  });

  it("keeps external AbortError as cancelled", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(modelFailureFor(error, "provider_dispatch", "sent_outcome_unknown")).toMatchObject({
      code: "cancelled",
      retryability: "caller_may_retry",
    });
  });
});

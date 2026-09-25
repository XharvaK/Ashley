import { describe, expect, it } from "vitest";
import { buildKernelEnvelope, validateKernelEnvelope } from "./kernel-envelope.js";
import type { CapturedModelAttemptIdentity, CapturedThoughtAttemptIdentity, ThoughtInvocationContext } from "../types.js";

const context: ThoughtInvocationContext = {
  invocationId: "thought-invocation-1",
  allocationId: 7,
  cycleId: "cycle-1",
  generation: 2,
  semanticPass: 1,
  structuralAttemptOrdinal: 0,
  authorityEpoch: 3,
  authorityVersionVector: { authority: 3 },
  triggerRef: "turn-1",
  semanticProjectionHash: "sha256:projection",
  dispatchMessagesHash: "sha256:messages",
  allowlistFingerprint: "sha256:allowlist",
  absoluteDeadlineAtMs: 1_000,
};

const attempt: CapturedModelAttemptIdentity = {
  allocationId: 7,
  modelFabricInvocationId: "mf-invocation-1",
  modelFabricAttemptId: "mf-attempt-1",
  attemptOrdinal: 1,
  dispatchSequence: 9,
  routeAlias: "thought",
  provider: "nim",
  configuredModelId: "openai/gpt-oss-20b",
  occupantId: "nim-thought",
  modelEpoch: 4,
  contractId: "ashley.thought.semantic.v1",
  buildIdentity: "build-1",
  logicalStructuredOutputId: "ashley.thought.semantic.v1.schema",
  semanticSchemaFingerprint: "sha256:schema",
  wireSchemaFingerprint: "sha256:wire-schema",
  actualWireBindingId: "nim-guided-json",
  schemaEnforcementMode: "native_json_schema",
  resourcePolicyFingerprint: "sha256:resource",
};

const directAttempt: CapturedThoughtAttemptIdentity = {
  backend: "command_code_api",
  allocationId: 7,
  attentionRequestId: 7,
  providerInvocationId: "cc-invocation-1",
  providerAttemptId: "cc-attempt-1",
  attemptOrdinal: 1,
  dispatchSequence: 9,
  routeAlias: "thought",
  provider: "command_code",
  requestedModelId: "meta/muse-spark-1.3-contributor",
  providerModel: "meta/muse-spark-1.3-contributor",
  reasoningEffort: "xhigh",
  providerRequestId: "cc-request-1",
  providerHttpStatus: 200,
  requestHash: "sha256:request",
  responseHash: "sha256:response",
  providerAttempts: 1,
  alternateProviderAttempts: 0,
  contractId: "ashley.thought.semantic.v1",
  buildIdentity: "build-1",
  logicalStructuredOutputId: "ashley.thought.semantic.v1.schema",
  semanticSchemaFingerprint: "sha256:schema",
  wireSchemaFingerprint: "sha256:wire-schema",
  actualWireBindingId: "command-code-json-object",
  schemaEnforcementMode: "json_object_compatibility",
};

const abstain = { kind: "abstain", reason: "insufficient_evidence", explanation: "not enough", evidenceRefs: [] } as const;

describe("Thought kernel envelope", () => {
  it("binds semantic output to captured actual attempt facts", () => {
    const envelope = buildKernelEnvelope({ context, attempt, response: abstain, parserValidatorIdentity: "parser-1", runtimeArtifactIdentity: "runtime-1" });
    expect(envelope).toMatchObject({
      invocationId: context.invocationId,
      allocationId: 7,
      capturedAttempt: attempt,
      kernelEnvelopeVersion: "ashley.thought.kernel-envelope.v1",
    });
    expect(validateKernelEnvelope(envelope)).toEqual({ ok: true });
  });

  it("rejects an attempt bound to another Attention allocation", () => {
    expect(() => buildKernelEnvelope({ context, attempt: { ...attempt, allocationId: 8 }, response: abstain, parserValidatorIdentity: "parser-1", runtimeArtifactIdentity: "runtime-1" })).toThrow("attempt_allocation_mismatch");
  });

  it("rejects incomplete actual wire and attempt identity facts", () => {
    expect(validateKernelEnvelope({
      ...buildKernelEnvelope({ context, attempt, response: abstain, parserValidatorIdentity: "parser-1", runtimeArtifactIdentity: "runtime-1" }),
      capturedAttempt: { ...attempt, actualWireBindingId: "" },
    })).toEqual({ ok: false, code: "attempt_identity" });
  });

  it("binds direct Command Code evidence without a Model Fabric receipt", () => {
    const envelope = buildKernelEnvelope({
      context: { ...context, conversationId: "conversation-1", wakeId: "wake-1" },
      attempt: directAttempt,
      response: abstain,
      parserValidatorIdentity: "parser-1",
      runtimeArtifactIdentity: "runtime-1",
    });
    expect(validateKernelEnvelope(envelope)).toEqual({ ok: true });
    expect(envelope).toMatchObject({
      conversationId: "conversation-1",
      wakeId: "wake-1",
      capturedAttempt: {
        backend: "command_code_api",
        providerInvocationId: "cc-invocation-1",
        providerAttemptId: "cc-attempt-1",
        providerAttempts: 1,
        alternateProviderAttempts: 0,
      },
    });
    expect("modelFabricAttemptId" in envelope.capturedAttempt).toBe(false);
  });

  it("rejects a direct attempt with an unexpected provider attempt count", () => {
    expect(validateKernelEnvelope({
      ...buildKernelEnvelope({ context, attempt: directAttempt, response: abstain, parserValidatorIdentity: "parser-1", runtimeArtifactIdentity: "runtime-1" }),
      capturedAttempt: { ...directAttempt, alternateProviderAttempts: 1 },
    })).toEqual({ ok: false, code: "attempt_identity" });
  });
});

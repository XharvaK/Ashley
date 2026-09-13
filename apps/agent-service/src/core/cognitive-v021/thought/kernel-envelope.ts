import { sha256 } from "../../model-fabric/hash.js";
import type {
  CapturedModelAttemptIdentity,
  KernelEnvelope,
  ThoughtInvocationContext,
  ThoughtSemanticOutput,
} from "../types.js";

export const THOUGHT_KERNEL_PROTOCOL_ID = "ashley.thought.kernel.v1" as const;
export const THOUGHT_KERNEL_ENVELOPE_VERSION = "ashley.thought.kernel-envelope.v1" as const;

export type KernelEnvelopeBuildInput = {
  context: ThoughtInvocationContext;
  attempt: CapturedModelAttemptIdentity;
  response: ThoughtSemanticOutput;
  parserValidatorIdentity: string;
  runtimeArtifactIdentity: string;
};

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) throw new Error(`envelope_${field}_missing`);
}

function validNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

export function buildKernelEnvelope(input: KernelEnvelopeBuildInput): KernelEnvelope {
  if (input.context.allocationId !== input.attempt.allocationId) {
    throw new Error("attempt_allocation_mismatch");
  }
  if (!Number.isInteger(input.context.generation) || input.context.generation < 0) {
    throw new Error("envelope_generation_invalid");
  }
  if (!Number.isInteger(input.context.semanticPass) || input.context.semanticPass < 0) {
    throw new Error("envelope_semantic_pass_invalid");
  }
  if (!Number.isInteger(input.context.structuralAttemptOrdinal) || input.context.structuralAttemptOrdinal < 0) {
    throw new Error("envelope_structural_attempt_invalid");
  }
  if (!Number.isFinite(input.context.absoluteDeadlineAtMs) || input.context.absoluteDeadlineAtMs <= 0) {
    throw new Error("envelope_deadline_invalid");
  }
  requireNonEmpty(input.context.invocationId, "invocation_id");
  requireNonEmpty(input.context.cycleId, "cycle_id");
  requireNonEmpty(input.context.triggerRef, "trigger_ref");
  requireNonEmpty(input.context.semanticProjectionHash, "semantic_projection_hash");
  requireNonEmpty(input.context.dispatchMessagesHash, "dispatch_messages_hash");
  requireNonEmpty(input.context.allowlistFingerprint, "allowlist_fingerprint");
  requireNonEmpty(input.parserValidatorIdentity, "parser_identity");
  requireNonEmpty(input.runtimeArtifactIdentity, "runtime_identity");
  if (input.response.kind !== "settlement" && input.response.kind !== "observation_intent"
    && input.response.kind !== "effect_intent" && input.response.kind !== "abstain") {
    throw new Error("envelope_semantic_kind_invalid");
  }
  const envelope: KernelEnvelope = {
    ...input.context,
    protocolIdentity: THOUGHT_KERNEL_PROTOCOL_ID,
    kernelEnvelopeVersion: THOUGHT_KERNEL_ENVELOPE_VERSION,
    parserValidatorIdentity: input.parserValidatorIdentity,
    runtimeArtifactIdentity: input.runtimeArtifactIdentity,
    capturedAttempt: { ...input.attempt },
    responseHash: `sha256:${sha256(input.response)}`,
  };
  const validation = validateKernelEnvelope(envelope);
  if (!validation.ok) throw new Error(`invalid_kernel_envelope:${validation.code}`);
  return envelope;
}

export type KernelEnvelopeValidation =
  | { ok: true }
  | { ok: false; code: string };

export function validateKernelEnvelope(value: unknown): KernelEnvelopeValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, code: "not_object" };
  const envelope = value as Partial<KernelEnvelope>;
  if (envelope.protocolIdentity !== THOUGHT_KERNEL_PROTOCOL_ID) return { ok: false, code: "protocol_identity" };
  if (envelope.kernelEnvelopeVersion !== THOUGHT_KERNEL_ENVELOPE_VERSION) return { ok: false, code: "envelope_version" };
  if (typeof envelope.invocationId !== "string" || typeof envelope.cycleId !== "string") return { ok: false, code: "context_identity" };
  if (!Number.isInteger(envelope.allocationId) || !Number.isInteger(envelope.generation)
    || !Number.isInteger(envelope.semanticPass) || !Number.isInteger(envelope.structuralAttemptOrdinal)) return { ok: false, code: "context_ordinals" };
  if (!Number.isFinite(envelope.absoluteDeadlineAtMs) || Number(envelope.absoluteDeadlineAtMs) <= 0) return { ok: false, code: "deadline" };
  if (typeof envelope.capturedAttempt !== "object" || envelope.capturedAttempt === null) return { ok: false, code: "attempt_missing" };
  const attempt = envelope.capturedAttempt;
  if (attempt.allocationId !== envelope.allocationId) return { ok: false, code: "attempt_allocation" };
  if (!validNonEmpty(attempt.modelFabricInvocationId) || !validNonEmpty(attempt.modelFabricAttemptId)
    || !validNonEmpty(attempt.provider) || !validNonEmpty(attempt.configuredModelId)
    || !validNonEmpty(attempt.occupantId) || !validNonEmpty(attempt.contractId)
    || !validNonEmpty(attempt.buildIdentity) || !validNonEmpty(attempt.logicalStructuredOutputId)
    || !validNonEmpty(attempt.semanticSchemaFingerprint) || !validNonEmpty(attempt.wireSchemaFingerprint)
    || !validNonEmpty(attempt.actualWireBindingId)
    || !validNonEmpty(attempt.schemaEnforcementMode) || !validNonEmpty(attempt.resourcePolicyFingerprint)) {
    return { ok: false, code: "attempt_identity" };
  }
  if (!Number.isInteger(attempt.attemptOrdinal) || attempt.attemptOrdinal < 1
    || !Number.isInteger(attempt.dispatchSequence) || attempt.dispatchSequence < 0
    || !Number.isInteger(attempt.modelEpoch) || attempt.modelEpoch < 0) {
    return { ok: false, code: "attempt_ordinals" };
  }
  if (attempt.routeAlias !== null && !validNonEmpty(attempt.routeAlias)) return { ok: false, code: "attempt_route" };
  if (typeof envelope.responseHash !== "string" || !envelope.responseHash.startsWith("sha256:")) return { ok: false, code: "response_hash" };
  return { ok: true };
}

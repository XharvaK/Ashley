import { sha256 } from "../model-fabric/hash.js";
import type {
  ConversationalCommitment,
  OwnerDispatchCoverage,
  OwnerObligationAttemptOutcome,
  OwnerObligationResolution,
} from "./types.js";

export type {
  OwnerDispatchCoverage,
  OwnerObligationAttemptOutcome,
  OwnerObligationOutcome,
  OwnerObligationResolution,
  DeliveryDisposition,
} from "./types.js";

export type OwnerObligationInput = Readonly<{
  eventId: string;
  eventKind: string;
  coverage: OwnerDispatchCoverage | null;
  attemptOutcome: OwnerObligationAttemptOutcome;
  speechMode?: "none" | "draft";
  conversationalCommitments?: readonly ConversationalCommitment[];
  settlementId?: string | null;
  outboxId?: number | null;
  deliveryOwnerExists?: boolean;
  remainingConsequence?: boolean;
  /**
   * Detached V1 async operation identity (detached-operation:<id> suffix).
   * Set only when Thought yields to a durably admitted detached
   * project.investigate. Never a generic deferred continuation.
   */
  detachedOperationId?: string | null;
  /** Global queue continuation owner before detached execution is bound. */
  workerUndertakingId?: string | null;
  /** True when Thought authored an interim hold draft bound to the operation. */
  interimSpeechAuthored?: boolean;
}>;

type CoverageFields = Pick<OwnerDispatchCoverage, "primaryEventId" | "coveredOwnerEventIds" | "uncoveredOwnerEventIds">;

const OWNER_OBLIGATION_EVENT_KINDS = new Set(["owner_message", "owner_utterance"]);

export function isOwnerObligationEventKind(kind: string): boolean {
  return OWNER_OBLIGATION_EVENT_KINDS.has(kind);
}

export function ownerCoverageHash(value: CoverageFields): string {
  return sha256({
    primaryEventId: value.primaryEventId,
    coveredOwnerEventIds: [...value.coveredOwnerEventIds],
    uncoveredOwnerEventIds: [...value.uncoveredOwnerEventIds],
  });
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function exactCoverage(
  eventId: string,
  coverage: OwnerDispatchCoverage | null,
): coverage is OwnerDispatchCoverage {
  if (!coverage || coverage.primaryEventId !== eventId) return false;
  if (!coverage.coveredOwnerEventIds.includes(eventId)) return false;
  if (!unique(coverage.coveredOwnerEventIds) || !unique(coverage.uncoveredOwnerEventIds)) return false;
  if (coverage.coveredOwnerEventIds.some((id) => coverage.uncoveredOwnerEventIds.includes(id))) return false;
  return ownerCoverageHash(coverage) === coverage.coverageHash;
}

function semanticCommitment(
  commitments: readonly ConversationalCommitment[] | undefined,
): ConversationalCommitment | null {
  return commitments?.length === 1 ? commitments[0] ?? null : null;
}

function envelopeBase(input: OwnerObligationInput): OwnerObligationResolution {
  const coverage = input.coverage;
  return {
    attemptOutcome: input.attemptOutcome,
    ownerObligationOutcome: "unresolved",
    primaryEventId: coverage?.primaryEventId ?? null,
    coveredOwnerEventIds: [...(coverage?.coveredOwnerEventIds ?? [])],
    uncoveredOwnerEventIds: [...(coverage?.uncoveredOwnerEventIds ?? [])],
    coverageHash: coverage?.coverageHash ?? null,
    semanticCommitment: semanticCommitment(input.conversationalCommitments),
    settlementId: input.settlementId ?? null,
    successorIdentity: null,
    remainingResponsibility: "owner_conversational_obligation",
    deliveryDisposition: "not_applicable",
  };
}

export function resolveOwnerObligation(input: OwnerObligationInput): OwnerObligationResolution {
  const ownerBearing = isOwnerObligationEventKind(input.eventKind);
  const base = envelopeBase(input);
  if (!ownerBearing) {
    return {
      ...base,
      ownerObligationOutcome: "not_applicable",
      primaryEventId: null,
      coveredOwnerEventIds: [],
      uncoveredOwnerEventIds: [],
      coverageHash: null,
      semanticCommitment: null,
      settlementId: null,
      remainingResponsibility: null,
      deliveryDisposition: "not_applicable",
    };
  }

  if (!exactCoverage(input.eventId, input.coverage)) {
    return {
      ...base,
      remainingResponsibility: "exact_owner_coverage_required",
    };
  }

  if (input.attemptOutcome !== "published") {
    if (input.attemptOutcome === "deferred" && typeof input.workerUndertakingId === "string"
      && input.workerUndertakingId.length > 0) {
      return {
        ...base,
        ownerObligationOutcome: "transferred",
        successorIdentity: `worker_undertaking:${input.workerUndertakingId}`,
        remainingResponsibility: "operation_pending",
        deliveryDisposition: input.interimSpeechAuthored === true ? "delivery_pending" : "not_applicable",
      };
    }
    if (input.attemptOutcome === "deferred" && typeof input.detachedOperationId === "string"
      && input.detachedOperationId.length > 0) {
      // Thought yielded to a durably admitted detached operation. The Owner
      // request stays open as operation_pending under the detached successor;
      // only a later Thought-B settlement, valid supersession, or valid
      // silence resolves it. This never reuses generic deferred_continuation.
      return {
        ...base,
        ownerObligationOutcome: "transferred",
        successorIdentity: `detached_operation:${input.detachedOperationId}`,
        remainingResponsibility: "operation_pending",
        deliveryDisposition: input.interimSpeechAuthored === true ? "delivery_pending" : "not_applicable",
      };
    }
    return {
      ...base,
      remainingResponsibility: input.attemptOutcome === "abstained"
        ? "owner_obligation_survives_abstention"
        : input.attemptOutcome === "deferred"
          ? "deferred_continuation"
          : input.attemptOutcome === "rejected"
            ? "publication_rejected"
            : "infrastructure_failure",
      deliveryDisposition: input.attemptOutcome === "failed" ? "delivery_unknown" : "not_applicable",
    };
  }

  if (input.speechMode === "draft") {
    const hasDeliveryOwner = input.deliveryOwnerExists === true
      && typeof input.outboxId === "number"
      && Number.isSafeInteger(input.outboxId)
      && input.outboxId > 0
      && typeof input.settlementId === "string"
      && input.settlementId.trim().length > 0;
    if (!hasDeliveryOwner) {
      return {
        ...base,
        remainingResponsibility: "delivery_owner_missing",
        deliveryDisposition: "delivery_unknown",
      };
    }
    return {
      ...base,
      ownerObligationOutcome: "transferred",
      successorIdentity: `speech_outbox:${input.outboxId}`,
      remainingResponsibility: "delivery_confirmation",
      deliveryDisposition: "handed_to_delivery",
    };
  }

  const explicitlySilent = input.speechMode === "none"
    && input.conversationalCommitments?.includes("silence") === true;
  if (explicitlySilent && input.remainingConsequence !== true && base.uncoveredOwnerEventIds.length === 0) {
    return {
      ...base,
      ownerObligationOutcome: "resolved",
      semanticCommitment: "silence",
      remainingResponsibility: null,
      deliveryDisposition: "not_required",
    };
  }

  return {
    ...base,
    remainingResponsibility: input.remainingConsequence === true
      ? "consequence_reconciliation"
      : "owner_conversational_obligation",
  };
}

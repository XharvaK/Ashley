import { assertCausalInvariants } from "./acceptance/causal-harness.js";
import {
  openCognitiveSidecarDb,
  readCognitiveSidecarMeta,
  updateCognitiveAuthorityEpoch,
} from "./sidecar/db.js";
import { reservedProductionCognitiveSidecarDbPath } from "../data-plane.js";

export * from "./types.js";
export { assertCausalInvariants } from "./acceptance/causal-harness.js";
export {
  openCognitiveSidecarDb,
  readCognitiveSidecarMeta,
  updateCognitiveAuthorityEpoch,
} from "./sidecar/db.js";
export * from "./sidecar/recovery.js";
export { reservedProductionCognitiveSidecarDbPath } from "../data-plane.js";
export * from "./evidence/conversation-log.js";
export * from "./cycle/inbox.js";
export * from "./cycle/fence.js";
export * from "./cycle/active.js";
export * from "./cycle/inbox-consumer.js";
export * from "./speech/outbox.js";
export * from "./speech/fidelity.js";
export * from "./speech/expression-adapter.js";
export * from "./speech/send.js";
export * from "./speech/infrastructure-notice.js";
export { OutboxDeliveryProjector, createOutboxProjector } from "./delivery/outbox-projector.js";
export type { OutboxDeliveryProjectorOptions, ProjectionGate } from "./delivery/outbox-projector.js";
export { evaluateExternalizationGate } from "./initiative/externalization.js";
export * from "./effect/in-flight.js";
export * from "./effect/effect-ref.js";
export {
  publishSemanticTransaction,
  getPublishedSettlementIdentity,
} from "./settlement/publish.js";
export type {
  PublicationOptions,
  PublicationResult,
  PublishedSettlementIdentity,
} from "./settlement/publish.js";
export { validateThoughtSettlementDraft, assertValidThoughtSettlementDraft } from "./settlement/validate.js";
export { buildThoughtInput } from "./thought/input.js";
export {
  invokeThoughtComplete,
  runThoughtModel,
  runCognitiveCycle,
  STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS,
} from "./thought/run.js";
export { getCapabilityReality } from "./thought/capability-reality.js";
export * from "./thought/counters.js";
export { adaptPerception, runPerceptionBeforeThought } from "./perception/adapter.js";
export { retrieveCandidates, tokenizeForDiscovery } from "./retrieval/discover.js";
export { applyWorkingContextDelta, listWorkingContext } from "./evidence/working-context.js";
export { applyConcernDelta, getConcern, listConcerns } from "./concerns/lineage.js";
export { applyOccupancyDelta, listOccupancy } from "./concerns/occupancy.js";
export { AUTHORITY_CODES, describeAuthorityCode } from "./authority/codes.js";
export { loadAuthorityPacks, loadEffectReceipts, bumpAuthorityEpoch } from "./authority/packs.js";
export { checkAuthority, hasStructuredCurrentnessEntitlement } from "./authority/check.js";
export { claimsCurrentness, claimsUnwitnessedReading } from "./authority/currentness-detectors.js";
export { classifyOperation, createObservationRequest } from "./observation/request.js";
export { createEffectProposal, dispatchEffect } from "./effect/proposal.js";
export {
  createV021LiveOperationExecutors,
} from "./dispatch/live-operations.js";
export type {
  V021LiveOperationExecutorOptions,
  V021LiveOperationExecutors,
} from "./dispatch/live-operations.js";
export { recoverInFlight } from "./effect/recovery.js";
export * from "./memory/nomination.js";
export * from "./memory/admission.js";
export * from "./memory/assertions.js";
export * from "./memory/supports.js";
export * from "./memory/views.js";
export * from "./memory/forget.js";
export * from "./commands.js";
export * from "./identity/learned-self.js";
export * from "./identity/constitution.js";
export * from "./calibration/occupant.js";
export * from "./relationship/constraints.js";
export * from "./migration/import-legacy.js";
export * from "./initiative/idle.js";
export * from "./initiative/future-triggers.js";
export * from "./private-budget/ledger.js";
export * from "./private-budget/policy-time-ledger.js";
export * from "./private-budget/recovery.js";
export * from "./observation/subscriptions.js";
export * from "./dispatch/live.js";
export * from "./dispatch/health.js";
export * from "./evidence/compatibility-projector.js";
export * from "./delivery/pending.js";

export function speechProjectionKey(outboxId: number): `speech:${number}` {
  return `speech:${outboxId}`;
}

export function systemProjectionKey(noticeId: number): `system:${number}` {
  return `system:${noticeId}`;
}

void assertCausalInvariants;
void openCognitiveSidecarDb;
void readCognitiveSidecarMeta;
void updateCognitiveAuthorityEpoch;
void reservedProductionCognitiveSidecarDbPath;

import { MAX_AUTHORITY_REVISIONS } from "../types.js";
import type {
  AuthorityCode,
  AuthorityPacks,
  AuthorityStage,
  AuthorityVerdict,
  EffectProposal,
  InFlightRecord,
  ObservationRequest,
  OperationalClaimState,
  PublishedCognitiveSettlement,
  ThoughtSettlementDraft,
  AuthorityCurrentnessBinding,
} from "../types.js";
import { requireCurrentAuthorityBinding } from "./barrier.js";
import { buildEffectRefMap } from "../effect/effect-ref.js";

function unique(codes: AuthorityCode[]): AuthorityCode[] {
  return [...new Set(codes)];
}

function settlementText(settlement: ThoughtSettlementDraft | PublishedCognitiveSettlement): string {
  return [
    ...(settlement.commitments?.epistemic ?? []).map((item) => item.statement),
    ...(settlement.speech.mustSay ?? []),
    settlement.speech.surfaceDraft ?? "",
  ].join(" ");
}

type HostEffectTruth = "missing" | "not_attempted" | "in_progress" | "outcome_unknown" | "failed" | "succeeded";

function resolveHostEffectTruth(
  effectId: string,
  packs: AuthorityPacks,
  activeEffects: readonly InFlightRecord[],
): HostEffectTruth {
  const receipt = packs.receipt.receiptsByEffectId[effectId];
  if (receipt) {
    if (receipt.outcome === "succeeded") return "succeeded";
    if (receipt.outcome === "failed") return "failed";
    if (receipt.outcome === "in_progress") return "in_progress";
    if (receipt.outcome === "not_attempted") return "not_attempted";
    if (receipt.outcome === "outcome_unknown") return "outcome_unknown";
  }
  const activeEffect = activeEffects.find((e) => e.effectId === effectId);
  if (activeEffect) {
    if (activeEffect.status === "in_flight") return "in_progress";
    if (activeEffect.status === "unknown") return "outcome_unknown";
  }
  return "missing";
}

function evaluateClaimMatrix(
  claimedState: OperationalClaimState,
  hostTruth: HostEffectTruth,
): { ok: true } | { ok: false; code: AuthorityCode } {
  // Absence of receipt is never proof of claim state
  if (hostTruth === "missing") {
    return { ok: false, code: "RECEIPT_REQUIRED" };
  }

  // Exact equality licenses the claim
  if (claimedState === hostTruth) {
    return { ok: true };
  }

  switch (claimedState) {
    case "not_attempted":
      if (hostTruth === "in_progress" || hostTruth === "outcome_unknown") {
        return { ok: false, code: "OPERATIONAL_CLAIM_STATE_MISMATCH" };
      }
      if (hostTruth === "failed" || hostTruth === "succeeded") {
        return { ok: false, code: "RECEIPT_CONTRADICTS_CLAIM" };
      }
      break;

    case "in_progress":
      if (hostTruth === "not_attempted") {
        return { ok: false, code: "RECEIPT_REQUIRED" };
      }
      if (hostTruth === "outcome_unknown") {
        return { ok: false, code: "IN_FLIGHT_UNKNOWN" };
      }
      if (hostTruth === "failed" || hostTruth === "succeeded") {
        return { ok: false, code: "RECEIPT_CONTRADICTS_CLAIM" };
      }
      break;

    case "outcome_unknown":
      if (hostTruth === "not_attempted") {
        return { ok: false, code: "RECEIPT_REQUIRED" };
      }
      if (hostTruth === "in_progress") {
        return { ok: false, code: "IN_FLIGHT_UNKNOWN" };
      }
      if (hostTruth === "failed" || hostTruth === "succeeded") {
        return { ok: false, code: "RECEIPT_CONTRADICTS_CLAIM" };
      }
      break;

    case "failed":
      if (hostTruth === "not_attempted") {
        return { ok: false, code: "RECEIPT_REQUIRED" };
      }
      if (hostTruth === "in_progress" || hostTruth === "outcome_unknown") {
        return { ok: false, code: "IN_FLIGHT_UNKNOWN" };
      }
      if (hostTruth === "succeeded") {
        return { ok: false, code: "RECEIPT_CONTRADICTS_CLAIM" };
      }
      break;

    case "succeeded":
      if (hostTruth === "not_attempted") {
        return { ok: false, code: "RECEIPT_REQUIRED" };
      }
      if (hostTruth === "in_progress" || hostTruth === "outcome_unknown") {
        return { ok: false, code: "IN_FLIGHT_UNKNOWN" };
      }
      if (hostTruth === "failed") {
        return { ok: false, code: "RECEIPT_CONTRADICTS_CLAIM" };
      }
      break;

    default: {
      const exhaustive: never = claimedState;
      return { ok: false, code: "OPERATIONAL_CLAIM_STATE_MISMATCH" };
    }
  }
  return { ok: false, code: "OPERATIONAL_CLAIM_STATE_MISMATCH" };
}

function checkSettlement(
  settlement: ThoughtSettlementDraft | PublishedCognitiveSettlement,
  packs: AuthorityPacks,
  authorityEpoch: number,
  activeEffects: readonly InFlightRecord[] = [],
): AuthorityVerdict {
  const codes: AuthorityCode[] = [];
  if (settlement.authorityEpoch !== authorityEpoch) codes.push("DISPATCH_EPOCH_CHANGED");
  if (settlement.speech.mode === "draft" && packs.relational.withdrawalActive) {
    codes.push("RELATIONAL_WITHDRAWAL");
  }
  if (
    packs.currentness.requireObservationForLatest &&
    (settlement.commitments?.epistemic ?? []).some((claim) => claim.dimensions.time === "current") &&
    !settlement.operations.observationsConsumed.some((id) => (new Set(packs.currentness.observedObservationIds ?? [])).has(id))
  ) {
    codes.push("CURRENTNESS_UNVERIFIED");
  }

  // Precompute domain-separated effectRef mapping for cycle
  const effectIds = [
    ...activeEffects.map((e) => e.effectId),
    ...Object.keys(packs.receipt.receiptsByEffectId),
    ...(settlement.operations.effectsCompleted ?? []),
  ];
  const effectRefMap = buildEffectRefMap(
    settlement.cycleId,
    settlement.generation,
    effectIds,
  );

  // Check structured operational commitments against host truth (25-cell matrix)
  const operationalClaims = settlement.commitments?.operational ?? [];
  const licensedEffectIds = new Set<string>();

  for (const claim of operationalClaims) {
    if (!effectRefMap.allowlist.has(claim.effectRef)) {
      codes.push("OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN");
      continue;
    }
    const effectId = effectRefMap.refToId.get(claim.effectRef)!;
    licensedEffectIds.add(effectId);
    const hostTruth = resolveHostEffectTruth(effectId, packs, activeEffects);
    const evaluation = evaluateClaimMatrix(claim.claimedState, hostTruth);
    if (!evaluation.ok) {
      codes.push(evaluation.code);
    }
    // NS-I1 bidirectional terminal binding:
    // If the host receipt is terminal (succeeded | failed), that effect's effectId MUST be in effectsCompleted before PASS is possible.
    const receipt = packs.receipt.receiptsByEffectId[effectId];
    if (
      evaluation.ok &&
      receipt != null &&
      (receipt.outcome === "succeeded" || receipt.outcome === "failed") &&
      !(settlement.operations.effectsCompleted ?? []).includes(effectId)
    ) {
      codes.push("RECEIPT_REQUIRED");
    }
  }

  // Check active effects that are NOT licensed by an operational claim
  for (const effect of activeEffects) {
    if (licensedEffectIds.has(effect.effectId)) continue;
    const receipt = packs.receipt.receiptsByEffectId[effect.effectId];
    if (!receipt) {
      if (effect.status === "unknown" || effect.status === "in_flight") {
        codes.push("IN_FLIGHT_UNKNOWN");
      }
      continue;
    }
    if (receipt.outcome === "outcome_unknown") {
      codes.push("IN_FLIGHT_UNKNOWN");
    }
  }

  // Check effectsCompleted: each must have a terminal physical receipt
  for (const effectId of (settlement.operations.effectsCompleted ?? [])) {
    const receipt = packs.receipt.receiptsByEffectId[effectId];
    if (!receipt) {
      codes.push("RECEIPT_REQUIRED");
      continue;
    }
    if (receipt.outcome !== "succeeded" && receipt.outcome !== "failed") {
      codes.push("IN_FLIGHT_UNKNOWN");
    }
  }

  if (settlement.authority.revisionCount >= MAX_AUTHORITY_REVISIONS && settlement.authority.objectionsApplied.length > 0) {
    codes.push("REVISION_BUDGET_EXHAUSTED");
  }
  if (packs.relational.neverMention.some((term) => settlementText(settlement).toLowerCase().includes(term.toLowerCase()))) {
    codes.push("RELATIONAL_BOUNDARY");
  }
  return codes.length === 0 ? { ok: true } : { ok: false, codes: unique(codes) };
}

function currentnessCodes(
  packs: AuthorityPacks,
  authorityDb?: import("node:sqlite").DatabaseSync,
  expected?: AuthorityCurrentnessBinding,
): AuthorityCode[] {
  const binding = packs.currentness.binding;
  if (!authorityDb && !binding) return [];
  if (!binding || packs.currentness.complete !== true) {
    return ["AUTHORITY_PACK_INCOMPLETE"];
  }
  if (expected && (
    binding.barrierId !== expected.barrierId ||
    binding.barrierEpoch !== expected.barrierEpoch ||
    binding.barrierRevision !== expected.barrierRevision ||
    JSON.stringify(binding.ownerVersions) !== JSON.stringify(expected.ownerVersions)
  )) {
    return ["AUTHORITY_VECTOR_STALE"];
  }
  if (!authorityDb) return [];
  try {
    requireCurrentAuthorityBinding(authorityDb, binding);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "authority_vector_stale";
    return message === "authority_barrier_not_stable"
      ? ["AUTHORITY_TRANSITION_ACTIVE"]
      : ["AUTHORITY_VECTOR_STALE"];
  }
}

function checkDispatch(
  proposal: EffectProposal | ObservationRequest,
  packs: AuthorityPacks,
  authorityEpoch: number,
): AuthorityVerdict {
  const codes: AuthorityCode[] = [];
  if (packs.stateEpoch.authorityEpoch !== authorityEpoch) codes.push("DISPATCH_EPOCH_CHANGED");
  if ("authorityEpoch" in proposal && proposal.authorityEpoch !== authorityEpoch) codes.push("DISPATCH_EPOCH_CHANGED");
  if ("kind" in proposal && /(?:send|notify|discord|message|write|delete|execute|operate)/i.test(proposal.kind) && packs.relational.withdrawalActive) {
    codes.push("RELATIONAL_WITHDRAWAL");
  }
  return codes.length === 0 ? { ok: true } : { ok: false, codes: unique(codes) };
}

export function checkAuthority(
  stage: AuthorityStage,
  input: {
    settlement?: ThoughtSettlementDraft | PublishedCognitiveSettlement;
    proposal?: EffectProposal | ObservationRequest;
    packs: AuthorityPacks;
    authorityEpoch: number;
    authorityDb?: import("node:sqlite").DatabaseSync;
    expectedCurrentness?: AuthorityCurrentnessBinding;
    /** Host-owned effects active for the cycle being settled. */
    activeEffects?: readonly InFlightRecord[];
  },
): AuthorityVerdict {
  const proposalCurrentness = input.proposal && "authorityCurrentness" in input.proposal
    ? input.proposal.authorityCurrentness
    : undefined;
  const currentness = currentnessCodes(
    input.packs,
    input.authorityDb,
    input.expectedCurrentness ?? proposalCurrentness,
  );
  if (stage === "settlement" && input.settlement) {
    const result = checkSettlement(input.settlement, input.packs, input.authorityEpoch, input.activeEffects);
    return result.ok && currentness.length === 0
      ? result
      : { ok: false, codes: unique([...currentness, ...(result.ok ? [] : result.codes)]) };
  }
  if ((stage === "dispatch" || stage === "proposal") && input.proposal) {
    const result = checkDispatch(input.proposal, input.packs, input.authorityEpoch);
    return result.ok && currentness.length === 0
      ? result
      : { ok: false, codes: unique([...currentness, ...(result.ok ? [] : result.codes)]) };
  }
  if (currentness.length > 0) return { ok: false, codes: currentness };
  return { ok: false, codes: ["STALE_STATE"] };
}

export function hasStructuredCurrentnessEntitlement(
  settlement: Pick<ThoughtSettlementDraft, "operations"> | null | undefined,
  currentness:
    | AuthorityPacks["currentness"]
    | { complete?: boolean; observedObservationIds?: string[]; binding?: unknown }
    | null
    | undefined,
): boolean {
  if (!settlement || !currentness) return false;
  const binding = (currentness as any).binding;
  const isBindingComplete =
    binding != null &&
    (binding.complete === true || (binding.complete !== false && currentness.complete === true));
  if (!isBindingComplete) return false;
  const observedIds = new Set(currentness.observedObservationIds ?? []);
  if (observedIds.size === 0) return false;
  return (settlement.operations?.observationsConsumed ?? []).some((id) => observedIds.has(id));
}

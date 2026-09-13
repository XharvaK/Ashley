import type { CatalogLifecycle, QualificationResultRecord } from "./catalog.js";
import type { ModelFabricOccupant } from "./portfolio.js";

export type HealthPredicates = Readonly<{
  configured: boolean;
  available: boolean;
  qualified: boolean;
  ownerApproved: boolean;
  active: boolean;
  degraded: boolean;
  cooldownUntilMs: number | null;
  ready: boolean;
}>;

export type Phase5HealthPredicates = Readonly<{
  transportRouteReady: boolean;
  thoughtContractQualified: boolean;
  releaseTruthMatched: boolean;
  productionAccepted: boolean;
  mismatchReasons: readonly string[];
}>;

/** W1 lifecycle predicates. Each remains independent from legacy route health. */
export function phase5HealthPredicates(input: {
  transportRouteReady: boolean;
  thoughtContractQualified: boolean;
  releaseTruthMatched: boolean;
  productionAccepted: boolean;
  mismatchReasons?: readonly string[];
}): Phase5HealthPredicates {
  return Object.freeze({
    transportRouteReady: input.transportRouteReady,
    thoughtContractQualified: input.thoughtContractQualified,
    releaseTruthMatched: input.releaseTruthMatched,
    productionAccepted: input.productionAccepted,
    mismatchReasons: Object.freeze([...(input.mismatchReasons ?? [])]),
  });
}

export type HealthPredicateInput = {
  configured: boolean;
  available?: boolean;
  qualified: boolean;
  ownerApproved: boolean;
  active: boolean;
  degraded?: boolean;
  cooldownUntilMs?: number | null;
  nowMs?: number;
};

export function healthPredicates(input: HealthPredicateInput): HealthPredicates {
  const nowMs = input.nowMs ?? Date.now();
  const cooldownUntilMs = input.cooldownUntilMs ?? null;
  const cooldownActive =
    cooldownUntilMs !== null && cooldownUntilMs > nowMs;
  const available = input.available !== false && !cooldownActive;
  const degraded = input.degraded === true || cooldownActive;
  return Object.freeze({
    configured: input.configured,
    available,
    qualified: input.qualified,
    ownerApproved: input.ownerApproved,
    active: input.active,
    degraded,
    cooldownUntilMs,
    ready:
      input.configured &&
      available &&
      input.qualified &&
      input.ownerApproved &&
      input.active &&
      !degraded,
  });
}

type StableEligibility = {
  configured: boolean;
  qualified: boolean;
  ownerApproved: boolean;
  active: boolean;
};

type HealthRecord = StableEligibility & {
  available: boolean;
  degraded: boolean;
  cooldownUntilMs: number | null;
};

const DEFAULT_RECORD: HealthRecord = {
  configured: true,
  qualified: true,
  ownerApproved: true,
  active: true,
  available: true,
  degraded: false,
  cooldownUntilMs: null,
};

export type HealthRegistry = Readonly<{
  setEligibility(
    occupantId: string,
    eligibility: StableEligibility,
  ): HealthPredicates;
  healthFor(occupantId: string, nowMs?: number): HealthPredicates;
  recordFailure(
    occupantId: string,
    input?: { cooldownMs?: number; nowMs?: number },
  ): HealthPredicates;
  recordSuccess(occupantId: string, nowMs?: number): HealthPredicates;
  snapshot(nowMs?: number): Readonly<Record<string, HealthPredicates>>;
  reset(): void;
}>;

export function createHealthRegistry(
  clock: () => number = () => Date.now(),
): HealthRegistry {
  const records = new Map<string, HealthRecord>();

  const ensure = (occupantId: string): HealthRecord => {
    const existing = records.get(occupantId);
    if (existing) return existing;
    const created = { ...DEFAULT_RECORD };
    records.set(occupantId, created);
    return created;
  };

  const toPredicates = (occupantId: string, nowMs = clock()): HealthPredicates => {
    const record = ensure(occupantId);
    return healthPredicates({ ...record, nowMs });
  };

  return {
    setEligibility(occupantId, eligibility) {
      const record = ensure(occupantId);
      Object.assign(record, eligibility);
      return toPredicates(occupantId);
    },
    healthFor(occupantId, nowMs = clock()) {
      return toPredicates(occupantId, nowMs);
    },
    recordFailure(occupantId, input = {}) {
      const record = ensure(occupantId);
      const nowMs = input.nowMs ?? clock();
      const cooldownMs = Math.max(0, input.cooldownMs ?? 30_000);
      record.available = false;
      record.degraded = true;
      record.cooldownUntilMs = nowMs + cooldownMs;
      return toPredicates(occupantId, nowMs);
    },
    recordSuccess(occupantId, nowMs = clock()) {
      const record = ensure(occupantId);
      record.available = true;
      record.degraded = false;
      record.cooldownUntilMs = null;
      return toPredicates(occupantId, nowMs);
    },
    snapshot(nowMs = clock()) {
      const result: Record<string, HealthPredicates> = {};
      for (const occupantId of records.keys()) {
        result[occupantId] = toPredicates(occupantId, nowMs);
      }
      return Object.freeze(result);
    },
    reset() {
      records.clear();
    },
  };
}

export type HealthQualification = Pick<
  QualificationResultRecord,
  | "schema"
  | "qualificationResultId"
  | "status"
  | "policyRowId"
  | "occupantId"
  | "invalidated"
>;

export type HealthOwnerApproval = {
  ownerApprovalRefId: string;
  decision: "approve";
  revoked: boolean;
  policyRowId: string;
  occupantId: string;
  qualificationResultId: string;
};

export type ApprovedChainEntry = {
  occupant: ModelFabricOccupant;
  qualification: HealthQualification | null;
  ownerApproval: HealthOwnerApproval | null;
  catalogLifecycle?: CatalogLifecycle;
  configured?: boolean;
  active?: boolean;
};

function entryIsApproved(
  entry: ApprovedChainEntry,
  policyRowId: string,
): boolean {
  const qualification = entry.qualification;
  const approval = entry.ownerApproval;
  return (
    entry.active !== false &&
    (entry.catalogLifecycle === undefined ||
      entry.catalogLifecycle === "owner_approved") &&
    qualification?.schema === "ashley.evaluation.qualification_result.v1" &&
    qualification.status === "PASS" &&
    qualification.invalidated === false &&
    qualification.policyRowId === policyRowId &&
    qualification.occupantId === entry.occupant.occupantId &&
    approval !== null &&
    approval.decision === "approve" &&
    approval.revoked === false &&
    approval.policyRowId === policyRowId &&
    approval.occupantId === entry.occupant.occupantId &&
    approval.qualificationResultId === qualification.qualificationResultId
  );
}

export function approvedChainFor(input: {
  policyRowId: string;
  candidates: readonly ApprovedChainEntry[];
}): readonly ApprovedChainEntry[] {
  return input.candidates.filter((candidate) =>
    entryIsApproved(candidate, input.policyRowId),
  );
}

function assertOrdered(candidates: readonly ApprovedChainEntry[]): void {
  let previousOrdinal = 0;
  for (const candidate of candidates) {
    const ordinal = candidate.occupant.ordinal;
    if (typeof ordinal !== "number" || ordinal <= previousOrdinal) {
      throw new Error("approved_chain_not_ordered");
    }
    previousOrdinal = ordinal;
  }
}

export type HealthSelectionReason =
  | "provider_unavailable"
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "manual_probe";

export type ApprovedChainWalk = Readonly<{
  selected: ApprovedChainEntry;
  approvedChain: readonly ApprovedChainEntry[];
  predicates: Readonly<Record<string, HealthPredicates>>;
  selectionReason: HealthSelectionReason | null;
}>;

export function walkApprovedChain(input: {
  policyRowId: string;
  candidates: readonly ApprovedChainEntry[];
  registry: HealthRegistry;
  selectionReason?: HealthSelectionReason;
  nowMs?: number;
}): ApprovedChainWalk {
  assertOrdered(input.candidates);
  const approvedChain = approvedChainFor(input);
  const predicates: Record<string, HealthPredicates> = {};
  for (const candidate of input.candidates) {
    const approved = approvedChain.includes(candidate);
    input.registry.setEligibility(candidate.occupant.occupantId, {
      configured: candidate.configured !== false,
      qualified: approved,
      ownerApproved: approved,
      active: candidate.active !== false,
    });
    predicates[candidate.occupant.occupantId] = input.registry.healthFor(
      candidate.occupant.occupantId,
      input.nowMs,
    );
  }
  for (const candidate of approvedChain) {
    const health = predicates[candidate.occupant.occupantId]!;
    if (health.ready) {
      return Object.freeze({
        selected: candidate,
        approvedChain,
        predicates: Object.freeze(predicates),
        selectionReason: input.selectionReason ?? null,
      });
    }
  }
  throw new Error("no_approved_occupant_ready");
}

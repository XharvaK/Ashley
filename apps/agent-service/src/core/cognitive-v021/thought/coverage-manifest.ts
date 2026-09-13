import {
  COVERAGE_DISPOSITIONS,
  type ContinuityCandidate,
  type CoverageDisposition,
} from "./continuity-candidate.js";

export { COVERAGE_DISPOSITIONS } from "./continuity-candidate.js";
export type { CoverageDisposition } from "./continuity-candidate.js";

export const GROUNDING_STATUSES = [
  "SUBSTANTIVE",
  "EMPTY",
  "UNKNOWN",
  "UNAVAILABLE",
  "UNREACHABLE",
  "UNRESOLVED_CONFLICT",
] as const;

export type GroundingStatus = (typeof GROUNDING_STATUSES)[number];

export type GroundingAssessment = Readonly<{
  disposition?: CoverageDisposition;
  sourceRecordCount?: number;
  eligibleRecordCount?: number;
  queryStatus?: "success" | "failed";
  infrastructureState?: "ready" | "unavailable" | "unknown";
  conflict?: boolean;
}>;

/**
 * Preserve absence, infrastructure state, and unresolved conflict as distinct
 * grounding states. No state is collapsed into a generic failure or EMPTY.
 */
export function groundingStatusFor(input: GroundingAssessment): GroundingStatus {
  if (input.queryStatus === "failed" || input.disposition === "UNREACHABLE") return "UNREACHABLE";
  if (input.infrastructureState === "unavailable") return "UNAVAILABLE";
  if (input.infrastructureState === "unknown") return "UNKNOWN";
  if (input.conflict === true) return "UNRESOLVED_CONFLICT";
  if (input.disposition === "EMPTY" || (input.sourceRecordCount ?? 0) === 0) return "EMPTY";
  if (input.disposition === "INELIGIBLE" || (input.sourceRecordCount ?? 0) > 0 && (input.eligibleRecordCount ?? 0) === 0) {
    return "UNRESOLVED_CONFLICT";
  }
  return "SUBSTANTIVE";
}

export type CoverageAssessment = {
  domain: string;
  disposition?: CoverageDisposition;
  querySucceeded?: boolean;
  queryFailed?: boolean;
  queryStatus?: "success" | "failed";
  sourceRecordCount?: number;
  eligibleRecordCount?: number;
  ineligibleRecordCount?: number;
  staleRecordCount?: number;
  source_record_count?: number;
  eligible_record_count?: number;
  ineligible_record_count?: number;
  stale_record_count?: number;
  candidateIds?: readonly string[];
  evidenceRefs?: readonly string[];
  required?: boolean;
  pointerOnly?: boolean;
  deferred?: boolean;
  omittedForBudget?: boolean;
  tombstoned?: boolean;
  redacted?: boolean;
  groundingStatus?: GroundingStatus;
};

export type CoverageManifestDomain = {
  domain: string;
  disposition: CoverageDisposition;
  source_record_count: number;
  eligible_record_count: number;
  ineligible_record_count: number;
  stale_record_count: number;
  candidate_ids: readonly string[];
  evidence_refs: readonly string[];
  required: boolean;
  pointer_only: boolean;
  sourceRecordCount: number;
  eligibleRecordCount: number;
  ineligibleRecordCount: number;
  staleRecordCount: number;
  grounding_status: GroundingStatus;
};

export type CoverageManifest = {
  version: 1;
  domains: readonly CoverageManifestDomain[];
  /** Compatibility alias for readers that call domain entries `entries`. */
  entries: readonly CoverageManifestDomain[];
  dispositionCounts: Readonly<Record<CoverageDisposition, number>>;
};

export class RequiredCoverageUnreachableError extends Error {
  readonly code = "coverage_required_unreachable";
  readonly domain: string;

  constructor(domain: string) {
    super(`coverage_required_unreachable:${domain}`);
    this.name = "RequiredCoverageUnreachableError";
    this.domain = domain;
  }
}

function count(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("coverage_count_invalid");
  return result;
}

function sourceCount(input: CoverageAssessment): number {
  return count(input.sourceRecordCount ?? input.source_record_count, 0);
}

function eligibleCount(input: CoverageAssessment): number | undefined {
  const value = input.eligibleRecordCount ?? input.eligible_record_count;
  return value === undefined ? undefined : count(value, 0);
}

function queryFailed(input: CoverageAssessment): boolean {
  return input.queryFailed === true || input.querySucceeded === false || input.queryStatus === "failed";
}

function validateExplicitDisposition(value: CoverageDisposition): CoverageDisposition {
  if (!(COVERAGE_DISPOSITIONS as readonly string[]).includes(value)) {
    throw new Error("coverage_disposition_invalid");
  }
  return value;
}

/**
 * Resolve coverage without allowing absence and ineligibility to collapse.
 * Explicit privacy and operational states take precedence over count-derived
 * states. Required query failure is a fail-closed error.
 */
export function classifyCoverage(input: CoverageAssessment): CoverageDisposition {
  if (typeof input.domain !== "string" || input.domain.trim() === "") {
    throw new Error("coverage_domain_required");
  }
  if (queryFailed(input)) {
    if (input.required) throw new RequiredCoverageUnreachableError(input.domain);
    return "UNREACHABLE";
  }
  if (input.tombstoned || input.redacted) return "INELIGIBLE";
  if (input.disposition !== undefined) return validateExplicitDisposition(input.disposition);
  if (input.deferred) return "DEFERRED";
  if (input.pointerOnly) return "POINTER_ONLY";
  if (input.omittedForBudget) return "OMITTED_FOR_BUDGET";

  const source = sourceCount(input);
  const eligible = eligibleCount(input) ?? (source > 0 ? source : 0);
  const stale = count(input.staleRecordCount ?? input.stale_record_count, 0);
  if (source === 0) return "EMPTY";
  if (eligible === 0 && stale === source) return "STALE";
  if (eligible === 0) return "INELIGIBLE";
  return "INCLUDED";
}

/** Descriptive aliases for callers that prefer a verb over `classifyCoverage`. */
export const resolveCoverageDisposition = classifyCoverage;
export const coverageDispositionForCounts = classifyCoverage;

function defaultCountForDisposition(
  disposition: CoverageDisposition,
  source: number,
  eligible: number | undefined,
): { source: number; eligible: number; ineligible: number; stale: number } {
  const derivedEligible = eligible ?? (
    disposition === "INCLUDED" || disposition === "OMITTED_FOR_BUDGET" || disposition === "POINTER_ONLY"
      ? Math.max(source, 1)
      : 0
  );
  return {
    source,
    eligible: derivedEligible,
    ineligible: disposition === "INELIGIBLE" ? Math.max(source, 1) : 0,
    stale: disposition === "STALE" ? Math.max(source, 1) : 0,
  };
}

function makeDomainEntry(input: CoverageAssessment): CoverageManifestDomain {
  const disposition = classifyCoverage(input);
  const counts = defaultCountForDisposition(
    disposition,
    sourceCount(input),
    eligibleCount(input),
  );
  const source = count(input.sourceRecordCount ?? input.source_record_count, counts.source);
  const eligible = count(input.eligibleRecordCount ?? input.eligible_record_count, counts.eligible);
  const ineligible = count(
    input.ineligibleRecordCount ?? input.ineligible_record_count,
    counts.ineligible,
  );
  const stale = count(input.staleRecordCount ?? input.stale_record_count, counts.stale);
  if (eligible > source && source > 0) throw new Error("coverage_count_invalid");
  const candidateIds = Object.freeze([...(input.candidateIds ?? [])]);
  const evidenceRefs = Object.freeze([...(input.evidenceRefs ?? [])]);
  return {
    domain: input.domain,
    disposition,
    source_record_count: source,
    eligible_record_count: eligible,
    ineligible_record_count: ineligible,
    stale_record_count: stale,
    candidate_ids: candidateIds,
    evidence_refs: evidenceRefs,
    required: input.required === true,
    pointer_only: input.pointerOnly === true || disposition === "POINTER_ONLY",
    sourceRecordCount: source,
    eligibleRecordCount: eligible,
    ineligibleRecordCount: ineligible,
    staleRecordCount: stale,
    grounding_status: input.groundingStatus ?? groundingStatusFor({
      disposition,
      sourceRecordCount: source,
      eligibleRecordCount: eligible,
      queryStatus: input.queryStatus,
      conflict: input.tombstoned === true || input.redacted === true,
    }),
  };
}

export function buildCoverageManifest(
  input: readonly CoverageAssessment[] | { domains: readonly CoverageAssessment[] },
): CoverageManifest {
  const assessments = "domains" in input ? input.domains : input;
  const domains = Object.freeze(assessments.map(makeDomainEntry));
  const dispositionCounts = Object.fromEntries(
    COVERAGE_DISPOSITIONS.map((disposition) => [disposition, 0]),
  ) as Record<CoverageDisposition, number>;
  for (const domain of domains) dispositionCounts[domain.disposition] += 1;
  return Object.freeze({
    version: 1 as const,
    domains,
    entries: domains,
    dispositionCounts: Object.freeze(dispositionCounts),
  });
}

export type AllocationCoverageCandidate = {
  id: string;
  section: string;
  required?: boolean;
  ref?: string;
  coverageDisposition?: CoverageDisposition;
  continuityCandidate?: ContinuityCandidate<unknown>;
  evidenceRefs?: readonly string[];
};

function allocationCoverageAssessment(
  candidate: AllocationCoverageCandidate,
  fallback: CoverageDisposition,
): CoverageAssessment {
  const continuity = candidate.continuityCandidate;
  const disposition = continuity?.disposition ?? candidate.coverageDisposition ?? fallback;
  return {
    domain: candidate.section,
    disposition,
    sourceRecordCount: 1,
    candidateIds: [candidate.id],
    evidenceRefs: candidate.evidenceRefs ?? continuity?.evidenceRefs ?? [],
    required: candidate.required === true,
    pointerOnly: continuity?.pointerOnly === true,
    tombstoned: continuity?.invalidationReason === "tombstoned",
    redacted: continuity?.invalidationReason === "redacted",
  };
}

/** Build the receipt manifest from the allocator's honest include/omit result. */
export function buildAllocationCoverageManifest(input: {
  included: readonly AllocationCoverageCandidate[];
  omitted?: readonly AllocationCoverageCandidate[];
  excluded?: readonly AllocationCoverageCandidate[];
}): CoverageManifest {
  return buildCoverageManifest([
    ...input.included.map((candidate) => allocationCoverageAssessment(candidate, "INCLUDED")),
    ...(input.omitted ?? []).map((candidate) => allocationCoverageAssessment(candidate, "OMITTED_FOR_BUDGET")),
    ...(input.excluded ?? []).map((candidate) => allocationCoverageAssessment(candidate, "INELIGIBLE")),
  ]);
}

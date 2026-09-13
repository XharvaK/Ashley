import type { DatabaseSync } from "node:sqlite";
import { getAuthoritativeLineageId } from "../../continuity/db.js";
import {
  listPendingOrAppliedTombstones,
  listTombstoneTargets,
  type ForgetTarget,
} from "../../continuity/forget-preview.js";

export const COVERAGE_DISPOSITIONS = [
  "INCLUDED",
  "OMITTED_FOR_BUDGET",
  "EMPTY",
  "UNREACHABLE",
  "INELIGIBLE",
  "STALE",
  "DEFERRED",
  "POINTER_ONLY",
] as const;

export type CoverageDisposition = (typeof COVERAGE_DISPOSITIONS)[number];

/**
 * Provider-independent transport for continuity evidence.
 *
 * The common layer owns identity bindings and authoritative invalidation only.
 * Domain adapters own currentness and eligibility decisions.
 */
export type ContinuityCandidate<T> = {
  readonly id: string;
  readonly candidateId?: string;
  readonly payload?: T;
  /** Compatibility alias for allocators that call the payload `data`. */
  readonly data?: T;
  readonly canonicalStore: string;
  readonly entityId: string;
  readonly sourceLineageId: string;
  readonly evidenceRefs: readonly string[];
  readonly disposition?: CoverageDisposition;
  readonly required?: boolean;
  readonly pointerOnly?: boolean;
  readonly redacted?: boolean;
  readonly sourceStatus?: string;
  readonly dataClassification?: string;
  readonly invalidationReason?: "tombstoned" | "redacted";
};

export type ContinuityCandidateInput<T> = {
  id?: string;
  candidateId?: string;
  payload?: T;
  data?: T;
  canonicalStore: string;
  entityId: string;
  sourceLineageId: string;
  evidenceRefs?: readonly string[];
  disposition?: CoverageDisposition;
  required?: boolean;
  pointerOnly?: boolean;
  redacted?: boolean;
  sourceStatus?: string;
  dataClassification?: string;
};

function requireNonEmpty(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return value;
}

function normalizedEvidenceRefs(value: readonly string[] | undefined): readonly string[] {
  const refs = value ?? [];
  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || ref.trim() === "")) {
    throw new Error("continuity_candidate_evidence_refs_invalid");
  }
  return Object.freeze([...new Set(refs)]);
}

function isCoverageDisposition(value: unknown): value is CoverageDisposition {
  return typeof value === "string" && (COVERAGE_DISPOSITIONS as readonly string[]).includes(value);
}

export function createContinuityCandidate<T>(
  input: ContinuityCandidateInput<T>,
): ContinuityCandidate<T> {
  const id = requireNonEmpty(input.id ?? input.candidateId, "continuity_candidate_id_required");
  const candidateId = input.candidateId ?? id;
  if (!isCoverageDisposition(input.disposition) && input.disposition !== undefined) {
    throw new Error("continuity_candidate_disposition_invalid");
  }
  const payload = input.payload !== undefined ? input.payload : input.data;
  const data = input.data !== undefined ? input.data : input.payload;
  return Object.freeze({
    id,
    candidateId,
    payload,
    data,
    canonicalStore: requireNonEmpty(input.canonicalStore, "continuity_candidate_store_required"),
    entityId: requireNonEmpty(input.entityId, "continuity_candidate_entity_required"),
    sourceLineageId: requireNonEmpty(input.sourceLineageId, "continuity_candidate_lineage_required"),
    evidenceRefs: normalizedEvidenceRefs(input.evidenceRefs),
    ...(input.disposition === undefined ? {} : { disposition: input.disposition }),
    ...(input.required === undefined ? {} : { required: input.required }),
    ...(input.pointerOnly === undefined ? {} : { pointerOnly: input.pointerOnly }),
    ...(input.redacted === undefined ? {} : { redacted: input.redacted }),
    ...(input.sourceStatus === undefined ? {} : { sourceStatus: input.sourceStatus }),
    ...(input.dataClassification === undefined ? {} : { dataClassification: input.dataClassification }),
  });
}

export type ContinuityTombstoneTarget = {
  entityType?: string;
  entityUuid?: string;
  entityId?: string;
  canonicalStore?: string;
};

export type ContinuityLineageContext = {
  continuity?: DatabaseSync;
  authoritativeLineageId?: string;
  /** Short alias for callers that already resolved the authoritative lineage. */
  lineageId?: string;
  tombstoneTargets?: readonly (ContinuityTombstoneTarget | ForgetTarget)[];
  redactedEntityIds?: ReadonlySet<string> | readonly string[];
};

function lineageMismatch(): Error {
  const error = new Error("continuity_lineage_mismatch") as Error & { code: string };
  error.code = "continuity_lineage_mismatch";
  return error;
}

function targetMatchesCandidate(
  target: ContinuityTombstoneTarget | ForgetTarget,
  candidate: ContinuityCandidate<unknown>,
): boolean {
  const entityType = "entityType" in target ? target.entityType : undefined;
  const entityUuid = "entityUuid" in target ? target.entityUuid : undefined;
  const storeMatches = entityType == null || entityType === candidate.canonicalStore;
  const entityMatches = entityUuid === candidate.entityId || entityUuid === candidate.id;
  return storeMatches && entityMatches;
}

function hasRedactedIdentity(
  candidate: ContinuityCandidate<unknown>,
  context: ContinuityLineageContext,
): boolean {
  if (candidate.redacted === true || candidate.sourceStatus === "redacted") return true;
  const ids = context.redactedEntityIds;
  if (ids == null) return false;
  if (typeof ids === "object" && ids !== null && "has" in ids) {
    const set = ids as ReadonlySet<string>;
    return set.has(candidate.entityId) || set.has(candidate.id);
  }
  const list = ids as readonly string[];
  return list.includes(candidate.entityId) || list.includes(candidate.id);
}

function hasAuthoritativeTombstone(
  candidate: ContinuityCandidate<unknown>,
  context: ContinuityLineageContext,
  lineageId: string | undefined,
): boolean {
  if (context.tombstoneTargets?.some((target) => targetMatchesCandidate(target, candidate))) {
    return true;
  }
  if (!context.continuity || !lineageId) return false;
  const tombstones = listPendingOrAppliedTombstones(context.continuity, lineageId);
  return tombstones.some((tombstone) =>
    listTombstoneTargets(context.continuity!, tombstone.tombstoneId)
      .some((target) => targetMatchesCandidate(target, candidate)),
  );
}

/**
 * Apply only authoritative continuity invalidations.
 *
 * This function deliberately does not recalculate domain currentness. A
 * candidate already marked STALE, DEFERRED, or another domain-owned state is
 * preserved unless an authoritative tombstone/redaction supersedes it.
 */
export function applyAuthoritativeInvalidations<T>(
  candidate: ContinuityCandidate<T>,
  context: ContinuityLineageContext = {},
): ContinuityCandidate<T> {
  const authoritativeLineageId =
    context.authoritativeLineageId ?? context.lineageId ??
    (context.continuity ? getAuthoritativeLineageId(context.continuity) : undefined);
  if (authoritativeLineageId && candidate.sourceLineageId !== authoritativeLineageId) {
    throw lineageMismatch();
  }

  const redacted = hasRedactedIdentity(candidate as ContinuityCandidate<unknown>, context);
  const tombstoned = hasAuthoritativeTombstone(
    candidate as ContinuityCandidate<unknown>,
    context,
    authoritativeLineageId,
  );
  if (!redacted && !tombstoned) return candidate;

  return Object.freeze({
    ...candidate,
    payload: undefined,
    data: undefined,
    disposition: "INELIGIBLE" as const,
    invalidationReason: tombstoned ? "tombstoned" as const : "redacted" as const,
  });
}

/** A payload is never exposed after an authoritative privacy invalidation. */
export function candidatePayload<T>(candidate: ContinuityCandidate<T>): T | undefined {
  return candidate.disposition === "INELIGIBLE" ? undefined : candidate.payload ?? candidate.data;
}

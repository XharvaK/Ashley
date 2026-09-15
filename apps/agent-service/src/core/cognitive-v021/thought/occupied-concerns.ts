import type {
  ConcernRecord,
  EpistemicReliability,
  EpistemicStatus,
  MindOccupancy,
  OccupancyStatus,
  OccupiedConcernProjection,
  ThoughtOccupancy,
} from "../types.js";

export const OCCUPIED_CONCERN_PROVENANCE = "cognitive_sidecar.concerns" as const;

/** Marker retained on the occupancy array while host-only fields are carried through allocation. */
export const OCCUPIED_CONCERN_PROJECTION = Symbol("occupied-concern-projection");

type OccupancyCarrier = ThoughtOccupancy[] & {
  [OCCUPIED_CONCERN_PROJECTION]?: readonly OccupiedConcernProjection[];
};

const ELIGIBLE_STATUSES = new Set<OccupancyStatus>([
  "active",
  "investigating",
  "waiting_for_evidence",
]);
const EPISTEMIC_STATUSES = new Set<EpistemicStatus>([
  "asserted",
  "interpreted",
  "unverified",
  "contradicted",
  "superseded",
  "unresolved",
]);
const EPISTEMIC_RELIABILITIES = new Set<EpistemicReliability>([
  "owner_supplied",
  "fallible_observation",
  "receipt_backed",
  "inferred",
  "unavailable_source",
]);

function isEligibleStatus(
  value: OccupancyStatus,
): value is OccupiedConcernProjection["status"] {
  return ELIGIBLE_STATUSES.has(value);
}

function compareOccupancy(left: MindOccupancy, right: MindOccupancy): number {
  return right.priority - left.priority
    || right.updatedGeneration - left.updatedGeneration
    || (left.concernId < right.concernId ? -1 : left.concernId > right.concernId ? 1 : 0);
}

type EligibleOccupancy = Omit<MindOccupancy, "status"> & {
  status: OccupiedConcernProjection["status"];
};

function inquiryDimensions(
  concern: ConcernRecord,
): OccupiedConcernProjection["dimensions"] | undefined {
  const dimensions = concern.dimensions as Partial<ConcernRecord["dimensions"]> | null | undefined;
  if (
    !dimensions
    || !EPISTEMIC_STATUSES.has(dimensions.status as EpistemicStatus)
    || !EPISTEMIC_RELIABILITIES.has(dimensions.reliability as EpistemicReliability)
  ) return undefined;
  return Object.freeze({
    status: dimensions.status as EpistemicStatus,
    reliability: dimensions.reliability as EpistemicReliability,
  });
}

/**
 * Join the existing bounded occupancy rows to the persisted concern ledger.
 * The join is fail-closed for missing concerns and inactive lifecycle rows.
 */
export function buildOccupiedConcernProjection(
  occupancy: readonly MindOccupancy[],
  concerns: readonly ConcernRecord[],
): readonly OccupiedConcernProjection[] {
  const concernsById = new Map(concerns.map((concern) => [concern.concernId, concern] as const));
  const candidates: Array<{
    row: EligibleOccupancy;
    concern: ConcernRecord;
    dimensions: OccupiedConcernProjection["dimensions"];
  }> = [];
  for (const row of occupancy) {
    if (!isEligibleStatus(row.status)) continue;
    const concern = concernsById.get(row.concernId);
    if (!concern || !isEligibleStatus(concern.status)) continue;
    // Occupancy is the authoritative current lifecycle owner for this
    // projection, but a stale concern row must not be allowed to rewrite it.
    // A mismatch is therefore excluded until the two existing owners agree.
    if (concern.status !== row.status) continue;
    const dimensions = inquiryDimensions(concern);
    // A malformed or incomplete epistemic record cannot safely support an
    // inquiry review. Keep the concern out of the model projection instead
    // of manufacturing certainty or reliability.
    if (dimensions === undefined) continue;
    candidates.push({
      row: { ...row, status: row.status },
      concern,
      dimensions,
    });
  }
  candidates.sort((left, right) => compareOccupancy(left.row, right.row));
  return Object.freeze(candidates.map(({ row, concern, dimensions }) => {
    return Object.freeze({
      concernId: row.concernId,
      statement: concern.statement,
      status: row.status,
      priority: row.priority,
      dimensions,
      provenance: OCCUPIED_CONCERN_PROVENANCE,
    });
  }));
}

/** Attach projection metadata without exposing host-only marker state to JSON. */
export function attachOccupiedConcernProjection(
  occupancy: ThoughtOccupancy[],
  projection: readonly OccupiedConcernProjection[],
): ThoughtOccupancy[] {
  Object.defineProperty(occupancy, OCCUPIED_CONCERN_PROJECTION, {
    value: projection,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return occupancy;
}

/** Carry exact statements through the existing occupancy allocation candidate. */
export function enrichOccupancyForThought(
  occupancy: readonly MindOccupancy[],
  projection: readonly OccupiedConcernProjection[],
): ThoughtOccupancy[] {
  const projectionById = new Map(projection.map((item) => [item.concernId, item] as const));
  const enriched = occupancy.map((row) => {
    const concern = projectionById.get(row.concernId);
    return concern === undefined
      ? { ...row }
      : { ...row, statement: concern.statement, provenance: concern.provenance };
  });
  return attachOccupiedConcernProjection(enriched, projection);
}

export function getOccupiedConcernProjection(
  occupancy: readonly ThoughtOccupancy[],
): readonly OccupiedConcernProjection[] | undefined {
  return (occupancy as OccupancyCarrier)[OCCUPIED_CONCERN_PROJECTION];
}

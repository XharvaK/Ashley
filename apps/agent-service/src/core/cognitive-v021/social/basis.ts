import { sha256 } from "../../model-fabric/hash.js";
import type { AttemptInputBasis } from "./types.js";

function requireBasisRefs(basis: AttemptInputBasis): void {
  if (basis.orderedRefs.length === 0) {
    throw new Error("attempt_basis_orderedRefs_empty");
  }
  if (!basis.speakerAttributionHash.trim()) {
    throw new Error("attempt_basis_speaker_attribution_missing");
  }
  if (!basis.projectionVersion.trim()) {
    throw new Error("attempt_basis_projection_version_missing");
  }
}

/**
 * Hash the exact ordered projection basis. Conversational refs are never sorted.
 * The frozen P0 type carries the caller-supplied ordered speaker attribution hash;
 * it is bound into every position tuple until later evidence-row adapters exist.
 */
export function hashAttemptBasis(basis: AttemptInputBasis): string {
  requireBasisRefs(basis);

  const orderedIdentity = basis.orderedRefs.map((rowId, position) => {
    const version = basis.versions[rowId];
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`attempt_basis_version_missing:${rowId}`);
    }
    return [rowId, version, basis.speakerAttributionHash, position];
  });

  return sha256([
    basis.schemaVersion,
    basis.projectionVersion,
    orderedIdentity,
    basis.replyEdges,
    basis.attachmentCoverage,
  ]);
}

/**
 * Return true only when every requested evidence ref occurs in basis order.
 * Empty or invalid bases fail closed instead of proving coverage accidentally.
 */
export function basisCoversEvidence(
  basis: AttemptInputBasis,
  evidenceRefs: readonly string[],
): boolean {
  if (basis.orderedRefs.length === 0 || evidenceRefs.length === 0) return false;

  let searchFrom = 0;
  for (const evidenceRef of evidenceRefs) {
    const position = basis.orderedRefs.indexOf(evidenceRef, searchFrom);
    if (position < 0 || !Number.isInteger(basis.versions[evidenceRef])) {
      return false;
    }
    searchFrom = position + 1;
  }
  return true;
}

import type { IdentityLayer } from "../types.js";

export type IdentityChangeClass = "observational" | "adaptive" | "foundational";

export type IdentityChangeClassification = {
  class: IdentityChangeClass;
  reason: string;
  targetKind: "value" | "boundary" | "trait" | "taste" | "opinion" | "other";
};

const FOUNDATIONAL_KINDS = new Set(["value", "boundary"]);
const ADAPTIVE_KINDS = new Set(["trait", "taste"]);
const OBSERVATIONAL_KINDS = new Set(["provenance", "timestamp", "confidence", "source"]);

/**
 * Deterministically classifies an identity change.
 * Model suggestions are advisory only; this function is authoritative.
 */
export function classifyIdentityChange(input: {
  layer: IdentityLayer;
  kind: string;
  currentText: string | null;
  proposedText: string;
  isNewEntry: boolean;
}): IdentityChangeClassification {
  const { layer, kind, currentText, proposedText, isNewEntry } = input;

  const lowerKind = kind.toLowerCase();
  const lowerProposed = proposedText.toLowerCase();

  // Foundational: honesty-related changes (any layer) - check FIRST
  if (
    /honesty|truth|uncertain|fabricat/.test(lowerKind) ||
    /honesty|truth|uncertain|fabricat/.test(lowerProposed) ||
    /certain|admit/.test(lowerProposed)
  ) {
    return {
      class: "foundational",
      reason: "honesty commitment changes are foundational",
      targetKind: "other",
    };
  }

  // Foundational: authority/permission changes - check FIRST
  if (
    /authority|permission|capability|policy|governance|approval|review|permit/.test(lowerKind) ||
    /authority|permission|capability|policy|governance|approval|review|permit/.test(lowerProposed)
  ) {
    return {
      class: "foundational",
      reason: "authority/permission changes are foundational",
      targetKind: "other",
    };
  }

  // Foundational: owner relationship boundaries - check FIRST
  if (
    /doc|owner|relationship|commitment|boundary/.test(lowerKind) ||
    /doc|owner|relationship|commitment|boundary/.test(lowerProposed)
  ) {
    return {
      class: "foundational",
      reason: "owner relationship boundary changes are foundational",
      targetKind: "boundary",
    };
  }

  // Foundational: any change that weakens review requirements - check FIRST
  if (/review|approval|approved|classification|weaken|remove|bypass/.test(lowerProposed)) {
    return {
      class: "foundational",
      reason: "changes to review requirements are foundational",
      targetKind: "other",
    };
  }

  // Foundational: any change to stable identity values or boundaries
  if (layer === "stable" && FOUNDATIONAL_KINDS.has(kind)) {
    return {
      class: "foundational",
      reason: `stable ${kind} changes are foundational`,
      targetKind: kind as "value" | "boundary",
    };
  }

  // Adaptive: stable traits and tastes (evolving preferences)
  if (layer === "stable" && ADAPTIVE_KINDS.has(kind)) {
    return {
      class: "adaptive",
      reason: `stable ${kind} changes are adaptive`,
      targetKind: kind as "trait" | "taste",
    };
  }

  // Adaptive: dynamic layer changes (opinions, habits, etc.)
  if (layer === "dynamic") {
    return {
      class: "adaptive",
      reason: "dynamic layer changes are adaptive",
      targetKind: kind === "opinion" ? "opinion" : "other",
    };
  }

  // Observational: metadata-only changes (provenance, confidence, etc.)
  if (isObservationalChange(currentText, proposedText, kind)) {
    return {
      class: "observational",
      reason: "metadata-only change",
      targetKind: "other",
    };
  }

  // Default: ambiguous changes are foundational (fail-safe)
  return {
    class: "foundational",
    reason: "ambiguous change classified as foundational",
    targetKind: "other",
  };
}

function isObservationalChange(currentText: string | null, proposedText: string, kind: string): boolean {
  if (!currentText) return false;
  if (currentText === proposedText) return true;
  
  // Only provenance/timestamp/confidence/source metadata changes
  // This is a narrow check - in practice, text content changes are never purely observational
  return OBSERVATIONAL_KINDS.has(kind);
}

/**
 * Determines if a change requires owner approval based on classification.
 */
export function requiresOwnerApproval(classification: IdentityChangeClassification): boolean {
  return classification.class === "foundational";
}

/**
 * Determines if a change can be applied locally without owner approval.
 */
export function canApplyLocally(classification: IdentityChangeClassification): boolean {
  return classification.class === "observational";
}
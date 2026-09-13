export type DataClassification =
  | "ordinary"
  | "sensitive"
  | "never_public"
  | "secret";

export const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  ordinary: 0,
  sensitive: 1,
  never_public: 2,
  secret: 3,
};

export function maxClassification(
  ...values: Array<DataClassification | null | undefined>
): DataClassification {
  let best: DataClassification = "ordinary";
  for (const value of values) {
    if (!value) continue;
    if (CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[best]) best = value;
  }
  return best;
}

/** Legacy API map — only when a real historical value exists. */
export function mapLegacySensitivity(
  value: "none" | "private" | string | null | undefined,
): DataClassification | null {
  if (value === "none") return "ordinary";
  if (value === "private") return "sensitive";
  return null;
}

/**
 * Unclassified conversational/owner content → never_public (not ordinary).
 * Prevents accidental public eligibility of unknown historical rows.
 */
export function defaultUnclassifiedConversational(): DataClassification {
  return "never_public";
}

export function canEnterConversationalStorage(
  classification: DataClassification,
): boolean {
  return classification !== "secret";
}

export function canEnterModelContext(
  classification: DataClassification,
  surface: "private" | "public",
): boolean {
  if (classification === "secret") return false;
  if (surface === "public") {
    return classification === "ordinary";
  }
  return true;
}

export type PublicTruth =
  | { allowed: false; reason: string }
  | { allowed: true };

/**
 * Public disclosure truth table. Protected ETH-PUB categories always deny.
 * Conditionally public Ashley material still needs Thought authorization.
 */
export function publicDisclosureTruth(
  classification: DataClassification | null | undefined,
  input: {
    hasProtectedCategory: boolean;
    thoughtAuthorized?: boolean;
    requiresThoughtAuth?: boolean;
  },
): PublicTruth {
  if (classification == null) {
    return { allowed: false, reason: "unknown_classification" };
  }
  if (input.hasProtectedCategory) {
    return { allowed: false, reason: "protected_category" };
  }
  switch (classification) {
    case "secret":
      return { allowed: false, reason: "secret" };
    case "never_public":
      return { allowed: false, reason: "never_public" };
    case "sensitive":
      return { allowed: false, reason: "sensitive_until_reclassified" };
    case "ordinary":
      if (input.requiresThoughtAuth && !input.thoughtAuthorized) {
        return { allowed: false, reason: "thought_authorization_required" };
      }
      return { allowed: true };
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

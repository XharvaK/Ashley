import {
  publicDisclosureTruth,
  type DataClassification,
} from "./classification.js";

export type EthPubProtectedCategory =
  | "doc_real_name"
  | "doc_location"
  | "doc_projects"
  | "doc_health_pharmacology"
  | "doc_sexuality"
  | "private_jokes"
  | "private_relationship_conflict";

export type DisclosureRequest = {
  classification: DataClassification | null | undefined;
  protectedCategories: EthPubProtectedCategory[];
  /** Ashley state/interests, grounded opinions, shared commitments, creator fact. */
  conditionallyPublicAshleyMaterial?: boolean;
  thoughtAuthorized?: boolean;
};

/**
 * Complete ETH-PUB pure policy. No public adapter in Wave 04 — tests only.
 */
export function evaluatePublicDisclosure(input: DisclosureRequest): {
  allowed: boolean;
  reason: string;
} {
  if (input.protectedCategories.length > 0) {
    return { allowed: false, reason: "protected_category" };
  }
  const truth = publicDisclosureTruth(input.classification, {
    hasProtectedCategory: false,
    requiresThoughtAuth: Boolean(input.conditionallyPublicAshleyMaterial),
    thoughtAuthorized: input.thoughtAuthorized,
  });
  if (!truth.allowed) {
    return { allowed: false, reason: truth.reason };
  }
  return { allowed: true, reason: "ok" };
}

export const ALL_ETH_PUB_PROTECTED: EthPubProtectedCategory[] = [
  "doc_real_name",
  "doc_location",
  "doc_projects",
  "doc_health_pharmacology",
  "doc_sexuality",
  "private_jokes",
  "private_relationship_conflict",
];

export type Pass3GeneralizationCase = Readonly<{
  id: string;
  replacementId: string;
  domain: "capability" | "non_tool";
  scenario:
    | "suitable_unfamiliar_capability"
    | "rename_reorder_invariance"
    | "familiar_unsuitable_capability"
    | "no_authorized_suitable_capability"
    | "causal_relevant_update"
    | "superficially_similar_irrelevant_update";
  evidenceMode:
    | "observation_then_follow_on_effect"
    | "identity_preservation"
    | "negative_suitability"
    | "absence_of_authorized_candidate"
    | "causal_relevance"
    | "contrast_relevance";
  requiresComposition: boolean;
}>;

/**
 * Frozen acceptance cases only. These records describe the situation and its
 * evidence mode; they deliberately do not encode the operation Thought
 * should choose or the answer it should author.
 */
export const PASS3_GENERALIZATION_CASES: readonly Pass3GeneralizationCase[] = Object.freeze([
  {
    id: "P3-CAP-A-UNFAMILIAR-SEARCH-01",
    replacementId: "P3-CAP-A-UNFAMILIAR-SEARCH-02",
    domain: "capability",
    scenario: "suitable_unfamiliar_capability",
    evidenceMode: "observation_then_follow_on_effect",
    requiresComposition: true,
  },
  {
    id: "P3-CAP-B-RENAME-REORDER-01",
    replacementId: "P3-CAP-B-RENAME-REORDER-02",
    domain: "capability",
    scenario: "rename_reorder_invariance",
    evidenceMode: "identity_preservation",
    requiresComposition: false,
  },
  {
    id: "P3-CAP-C-FAMILIAR-UNSUITABLE-01",
    replacementId: "P3-CAP-C-FAMILIAR-UNSUITABLE-02",
    domain: "capability",
    scenario: "familiar_unsuitable_capability",
    evidenceMode: "negative_suitability",
    requiresComposition: false,
  },
  {
    id: "P3-CAP-D-NO-AUTHORIZED-CANDIDATE-01",
    replacementId: "P3-CAP-D-NO-AUTHORIZED-CANDIDATE-02",
    domain: "capability",
    scenario: "no_authorized_suitable_capability",
    evidenceMode: "absence_of_authorized_candidate",
    requiresComposition: false,
  },
  {
    id: "P3-NT-1-RELEVANT-UPDATE-01",
    replacementId: "P3-NT-1-RELEVANT-UPDATE-02",
    domain: "non_tool",
    scenario: "causal_relevant_update",
    evidenceMode: "causal_relevance",
    requiresComposition: false,
  },
  {
    id: "P3-NT-2-IRRELEVANT-UPDATE-01",
    replacementId: "P3-NT-2-IRRELEVANT-UPDATE-02",
    domain: "non_tool",
    scenario: "superficially_similar_irrelevant_update",
    evidenceMode: "contrast_relevance",
    requiresComposition: false,
  },
] as const);

export const PASS3_GENERALIZATION_CASE_IDS = Object.freeze(
  PASS3_GENERALIZATION_CASES.map((item) => item.id),
);

export const PASS3_GENERALIZATION_REPLACEMENT_CASE_IDS = Object.freeze(
  PASS3_GENERALIZATION_CASES.map((item) => item.replacementId),
);

import type { DatabaseSync } from "node:sqlite";
import { canEnterModelContext } from "../../privacy/classification.js";
import type { MemoryAssertion, MemoryKind } from "../types.js";
import { listMemoryAssertions } from "./assertions.js";

export type OwnerKnowledgeView = MemoryAssertion[];

export type RelationalConstraintView = {
  assertions: MemoryAssertion[];
  neverMention: string[];
  withdrawalActive: boolean;
};

const OWNER_KNOWLEDGE_KINDS: MemoryKind[] = [
  "owner_preference",
  "owner_self_description",
  "owner_goal",
  "owner_world_claim",
];

/** Deterministic, live-only view used by `/memory` and Thought. */
export function buildOwnerKnowledgeView(db: DatabaseSync): OwnerKnowledgeView {
  return listMemoryAssertions(db, {
    live: true,
    memoryKinds: OWNER_KNOWLEDGE_KINDS,
    modelContext: true,
  });
}

export const listOwnerKnowledge = buildOwnerKnowledgeView;

export function buildRelationalConstraintView(
  db: DatabaseSync,
  options: { withdrawalActive?: boolean } = {},
): RelationalConstraintView {
  const assertions = listMemoryAssertions(db, {
    live: true,
    memoryKinds: ["relational_boundary"],
    modelContext: true,
  });
  return {
    assertions,
    neverMention: assertions
      .filter((assertion) => canEnterModelContext(assertion.dataClassification, "private"))
      .map((assertion) => assertion.statement),
    withdrawalActive: options.withdrawalActive ?? false,
  };
}

/** Mechanical compact representation. It does not ask a model to summarize. */
export function renderOwnerKnowledgeView(view: OwnerKnowledgeView): string[] {
  return view.map((assertion) => assertion.statement);
}

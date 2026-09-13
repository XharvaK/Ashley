import type { DatabaseSync } from "node:sqlite";
import { canEnterModelContext } from "../../privacy/classification.js";
import type { LearnedSelfSlice, MemoryAssertion, MemoryKind } from "../types.js";
import { listMemoryAssertions } from "../memory/assertions.js";

export type LearnedSelfEntry = {
  memoryKind: MemoryKind;
  statement: string;
};

/** LearnedSelf is a read-only projection; callers cannot persist candidates here. */
export function validateLearnedSelfEntry(input: LearnedSelfEntry): true {
  if (input.memoryKind === "owner_world_claim") {
    throw new Error("learned_self_world_claim_forbidden");
  }
  if (input.memoryKind !== "learned_self_evidence") {
    throw new Error("learned_self_kind_invalid");
  }
  if (!input.statement.trim()) throw new Error("learned_self_statement_required");
  return true;
}

function addEntry(slice: LearnedSelfSlice, assertion: MemoryAssertion): void {
  if (!assertion.live || assertion.memoryKind !== "learned_self_evidence") return;
  if (!canEnterModelContext(assertion.dataClassification, "private")) return;
  const statement = assertion.statement.trim();
  if (!statement) return;
  if (statement.toLowerCase().startsWith("interest:")) {
    slice.interests.push(statement.slice("interest:".length).trim());
  } else if (statement.toLowerCase().startsWith("disposition:")) {
    slice.dispositions.push(statement.slice("disposition:".length).trim());
  } else {
    slice.dispositions.push(statement);
  }
}

export function buildLearnedSelfSlice(
  db: DatabaseSync,
  supplied?: MemoryAssertion[],
): LearnedSelfSlice {
  const slice: LearnedSelfSlice = { dispositions: [], interests: [] };
  const assertions = supplied ?? listMemoryAssertions(db, {
    live: true,
    memoryKinds: ["learned_self_evidence"],
    modelContext: true,
  });
  for (const assertion of assertions) addEntry(slice, assertion);
  return {
    dispositions: [...new Set(slice.dispositions)],
    interests: [...new Set(slice.interests)],
  };
}

export const readLearnedSelfSlice = buildLearnedSelfSlice;

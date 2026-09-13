import type { DatabaseSync } from "node:sqlite";
import { insertAssertion } from "../memory/assertions.js";
import {
  admitLearnedCandidate,
  acceptLearnedInfluence,
  type LearnedInfluenceEvidenceInput,
} from "./admit.js";
import type { LearnedInfluence } from "./types.js";

export const OWNER_ID = "c3-owner";

export function c1Assertion(
  db: DatabaseSync,
  input: {
    text: string;
    observedAt: string;
    subjectFacet?: "owner_model" | "ashley_side";
    classification?: "ordinary" | "sensitive" | "never_public" | "secret";
  },
): number {
  return insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "owner_interpretation",
    subjectFacet: input.subjectFacet ?? "ashley_side",
    lineageKind: input.subjectFacet === "owner_model" ? "owner_designated" : "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    claimText: input.text,
    sourceKind: "c3_fixture_live",
    recordedAt: input.observedAt,
    authorityFrom: input.observedAt,
    worldIntervalBasis: "adjudicated",
    dataClassification: input.classification ?? "ordinary",
  });
}

export function evidence(
  assertionId: number,
  observedAt: string,
  provenance: "live" | "shadow" = "live",
): LearnedInfluenceEvidenceInput {
  return {
    evidenceType: "assertion",
    evidenceId: String(assertionId),
    assertionId,
    observedAt,
    provenance,
  };
}

export function candidateInput(
  evidenceItems: LearnedInfluenceEvidenceInput[],
  overrides: Record<string, unknown> = {},
): Parameters<typeof admitLearnedCandidate>[1] {
  return {
    ownerId: OWNER_ID,
    kind: "interest",
    subjectFacet: "ashley_side",
    semanticOwner: "memory_evidence",
    semanticOwnerRef: "interest:compilers",
    lineageKind: "ashley_native",
    influenceClass: "I1",
    text: "Ashley is interested in compilers",
    evidence: evidenceItems,
    capabilityMode: "dark_apply",
    ...overrides,
  } as Parameters<typeof admitLearnedCandidate>[1];
}

export function admitAndAccept(
  db: DatabaseSync,
  evidenceItems: LearnedInfluenceEvidenceInput[],
  overrides: Record<string, unknown> = {},
): LearnedInfluence {
  const admitted = admitLearnedCandidate(db, candidateInput(evidenceItems, overrides));
  return acceptLearnedInfluence(db, admitted.id, {
    adjudicator: "thought",
    adjudicationDecisionId: "thought-c3-fixture",
    capabilityMode: "dark_apply",
  });
}

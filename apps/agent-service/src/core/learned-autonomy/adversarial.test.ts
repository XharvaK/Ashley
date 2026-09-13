import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { recordIdentityEntry } from "../identity/store.js";
import { admitLearnedCandidate, acceptLearnedInfluence } from "./admit.js";
import { computeCurrentSharedOverlap } from "./overlap-projection.js";
import { c1Assertion, candidateInput, evidence, OWNER_ID } from "./test-fixtures.js";

describe("C3 learned-autonomy adversarial boundaries", () => {
  it("does not qualify owner approval, sentiment, repetition, or model JSON without C1 evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(() => admitLearnedCandidate(db, candidateInput([], {
        ownerApproval: true,
        sentiment: 1,
        repetitionCount: 99,
        modelOutput: "{\"interest\":true}",
      }))).toThrow("learned_influence_evidence_minimum");
    } finally {
      db.close();
    }
  });

  it("rejects shared overlap as inherited provenance and rejects capability mode misuse", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, { text: "shared compiler interest", observedAt: "2026-08-01T00:00:00.000Z", subjectFacet: "owner_model" });
      const second = c1Assertion(db, { text: "shared compiler interest", observedAt: "2026-08-02T00:00:00.000Z", subjectFacet: "ashley_side" });
      expect(computeCurrentSharedOverlap(db, OWNER_ID)).toEqual(expect.arrayContaining([
        expect.objectContaining({ ownerAssertionId: first, ashleyAssertionId: second }),
      ]));
      expect(() => admitLearnedCandidate(db, candidateInput([
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ], { lineageKind: "explicit_seed" }))).toThrow("learned_influence_inherited_lineage_requires_seed");
      expect(() => admitLearnedCandidate(db, candidateInput([
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ], { capabilityMode: "apply" }))).toThrow("learned_influence_live_apply_not_authorized");
      expect(() => acceptLearnedInfluence(db, 1, {
        adjudicator: "model" as "thought",
        adjudicationDecisionId: "m",
        capabilityMode: "dark_apply",
      })).toThrow("learned_influence_adjudicator_invalid");
    } finally {
      db.close();
    }
  });
});

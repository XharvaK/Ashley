import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  acceptLearnedInfluence,
  admitLearnedCandidate,
  demoteLearnedInfluence,
  getLearnedInfluence,
} from "../learned-autonomy/admit.js";
import {
  C4_OWNER,
  C4_TIME_1,
  C4_TIME_2,
  c4Assertion,
  c4Decision,
} from "./test-fixtures.js";
import { selectConsequentialPrediction } from "./predictions.js";
import { currentWorkingViewLinks } from "./view-links.js";

function c3LearnedInterest(
  db: DatabaseSync,
  firstAssertionId: number,
  secondAssertionId: number,
) {
  const candidate = admitLearnedCandidate(db, {
    ownerId: C4_OWNER,
    kind: "interest",
    subjectFacet: "ashley_side",
    semanticOwner: "memory_evidence",
    semanticOwnerRef: `assertion:${firstAssertionId}`,
    lineageKind: "ashley_native",
    influenceClass: "I1",
    text: "Ashley is interested in compilers.",
    evidence: [
      {
        evidenceType: "assertion",
        evidenceId: String(firstAssertionId),
        assertionId: firstAssertionId,
        observedAt: C4_TIME_1,
        provenance: "live",
      },
      {
        evidenceType: "assertion",
        evidenceId: String(secondAssertionId),
        assertionId: secondAssertionId,
        observedAt: C4_TIME_2,
        provenance: "live",
      },
    ],
    capabilityMode: "dark_apply",
  }, new Date(C4_TIME_2));
  return acceptLearnedInfluence(db, candidate.id, {
    adjudicator: "thought",
    adjudicationDecisionId: "c4-c3-interface-fixture",
    capabilityMode: "dark_apply",
  }, new Date(C4_TIME_2));
}

describe("C4 C3 learned-interest interface", () => {
  it("consumes a qualified C3 binding through current C1 evidence and stops after C1 correction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Assertion(db, "Ashley values careful compiler work.", C4_TIME_1);
      const second = c4Assertion(db, "The compiler interest persisted into a later turn.", C4_TIME_2);
      const learned = c3LearnedInterest(db, first, second);
      const prediction = selectConsequentialPrediction(db, {
        ownerId: C4_OWNER,
        decisionId: c4Decision(db),
        judgmentText: "The qualified compiler interest is likely to remain useful.",
        judgmentClass: "ashley_interest",
        evidenceRefs: [{ type: "learned_influence", id: learned.id }],
        evidentialStrength: 0.8,
        expectedObservableOutcome: { observed: true },
        expectedHorizon: "next_grounded_activity",
        modelRouteReceiptId: "route-receipt:c4-c3-interface",
        workingViewAssertionId: first,
        capabilityMode: "dark_apply",
        createdAt: C4_TIME_2,
      });

      expect(prediction.evidenceRefs).toEqual([
        { type: "learned_influence", id: learned.id },
      ]);
      expect(currentWorkingViewLinks(db, prediction, C4_TIME_2)).toHaveLength(1);

      db.prepare(
        "UPDATE memory_assertions SET termination_reason = 'invalidated', authority_to = ? WHERE id = ?",
      ).run("2026-08-21T10:00:00.001Z", second);

      expect(currentWorkingViewLinks(db, prediction, C4_TIME_2)).toEqual([]);
      expect(getLearnedInfluence(db, learned.id)?.contradictionState).toBe("owner_corrected");
    } finally {
      db.close();
    }
  });

  it("does not keep a C4 working view current after C3 demotion", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Assertion(db, "Ashley values careful compiler work.", C4_TIME_1);
      const second = c4Assertion(db, "The compiler interest persisted into a later turn.", C4_TIME_2);
      const learned = c3LearnedInterest(db, first, second);
      const prediction = selectConsequentialPrediction(db, {
        ownerId: C4_OWNER,
        decisionId: c4Decision(db),
        judgmentText: "The qualified compiler interest is likely to remain useful.",
        judgmentClass: "ashley_interest",
        evidenceRefs: [{ type: "learned_influence", id: learned.id }],
        evidentialStrength: 0.8,
        expectedObservableOutcome: { observed: true },
        expectedHorizon: "next_grounded_activity",
        modelRouteReceiptId: "route-receipt:c4-c3-demotion",
        workingViewAssertionId: first,
        capabilityMode: "dark_apply",
        createdAt: C4_TIME_2,
      });

      expect(currentWorkingViewLinks(db, prediction, C4_TIME_2)).toHaveLength(1);
      demoteLearnedInfluence(db, learned.id, "C3 qualification was demoted", new Date(C4_TIME_2));
      expect(currentWorkingViewLinks(db, prediction, C4_TIME_2)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

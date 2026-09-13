import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { recordIdentityEntry, listIdentity } from "../identity/store.js";
import {
  acceptLearnedInfluence,
  admitLearnedCandidate,
  recordIdentitySeedLineage,
} from "./admit.js";
import { computeCurrentSharedOverlap } from "./overlap-projection.js";
import {
  OWNER_ID,
  c1Assertion,
  candidateInput,
  evidence,
} from "./test-fixtures.js";

describe("C3 learned-interest admission", () => {
  it("validates C1 evidence but leaves Ashley adjudication explicit", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, {
        text: "Ashley notices compiler design",
        observedAt: "2026-08-01T00:00:00.000Z",
      });
      const second = c1Assertion(db, {
        text: "Ashley returns to compiler design",
        observedAt: "2026-08-02T00:00:00.000Z",
      });
      const pending = admitLearnedCandidate(db, candidateInput([
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]));
      expect(pending.proposalLifecycle).toBe("proposed");
      expect(pending.adjudicationState).toBe("pending");
      expect(pending.qualifiedAt).toBeNull();

      const accepted = acceptLearnedInfluence(db, pending.id, {
        adjudicator: "thought",
        adjudicationDecisionId: "decision-42",
        capabilityMode: "dark_apply",
      });
      expect(accepted.adjudicationState).toBe("accepted");
      expect(accepted.adjudicationDecisionId).toBe("decision-42");
      expect(accepted.provenance).toBe("live");
      expect(accepted.dataClassification).toBe("ordinary");
    } finally {
      db.close();
    }
  });

  it("refuses model-only admission and insufficient or shadow evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, {
        text: "one",
        observedAt: "2026-08-01T00:00:00.000Z",
      });
      const second = c1Assertion(db, {
        text: "two",
        observedAt: "2026-08-02T00:00:00.000Z",
      });
      expect(() => admitLearnedCandidate(db, candidateInput([
        evidence(first, "2026-08-01T00:00:00.000Z"),
      ]))).toThrow("learned_influence_evidence_minimum");
      expect(() => admitLearnedCandidate(db, candidateInput([
        evidence(first, "2026-08-01T00:00:00.000Z", "shadow"),
        evidence(second, "2026-08-02T00:00:00.000Z", "shadow"),
      ]))).toThrow("learned_influence_live_evidence_required");
      expect(() => acceptLearnedInfluence(db, 999, {
        adjudicator: "model" as "thought",
        adjudicationDecisionId: "model-output",
        capabilityMode: "dark_apply",
      })).toThrow("learned_influence_adjudicator_invalid");
    } finally {
      db.close();
    }
  });

  it("preserves explicit inherited seed lineage and computes overlap without storing a third identity", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const inherited = recordIdentityEntry(db, {
        ownerId: OWNER_ID,
        layer: "stable",
        kind: "taste.compiler_design",
        text: "Compiler design is worth studying.",
        source: "seeded",
      });
      recordIdentitySeedLineage(db, {
        ownerId: OWNER_ID,
        identityEntryId: inherited,
        disposition: "retained",
        seedSource: "explicit_seed",
      });
      const owner = c1Assertion(db, {
        text: "Compiler design is worth studying.",
        observedAt: "2026-08-01T00:00:00.000Z",
        subjectFacet: "owner_model",
      });
      const ashley = c1Assertion(db, {
        text: "Compiler design is worth studying.",
        observedAt: "2026-08-02T00:00:00.000Z",
        subjectFacet: "ashley_side",
      });
      const overlap = computeCurrentSharedOverlap(db, OWNER_ID);
      expect(overlap).toEqual(expect.arrayContaining([
        expect.objectContaining({ ownerAssertionId: owner, ashleyAssertionId: ashley }),
      ]));
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM learned_influences WHERE subject_facet = 'shared_projection'",
      ).get()).toEqual({ count: 0 });
      expect(listIdentity(db, OWNER_ID)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: inherited, text: "Compiler design is worth studying." }),
      ]));
    } finally {
      db.close();
    }
  });
});

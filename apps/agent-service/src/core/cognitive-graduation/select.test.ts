import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { setDecisionOutcome } from "../agency/log.js";
import {
  C4_OWNER,
  C4_TIME_1,
  C4_TIME_2,
  c4Assertion,
  c4Decision,
} from "./test-fixtures.js";
import { selectConsequentialPrediction } from "./predictions.js";
import { listWorkingViewLinks } from "./view-links.js";

describe("C4 explicit consequential prediction selection", () => {
  it("stores a bounded prediction with two current C1 references and a working-view link", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Assertion(db, "Ashley values careful compiler work.", C4_TIME_1);
      const second = c4Assertion(db, "The compiler interest persisted into a later turn.", C4_TIME_2);
      const decisionId = c4Decision(db);
      const prediction = selectConsequentialPrediction(db, {
        ownerId: C4_OWNER,
        decisionId,
        judgmentText: "The compiler interest is likely to remain useful.",
        judgmentClass: "ashley_interest",
        evidenceRefs: [
          { type: "assertion", id: first },
          { type: "assertion", id: second },
        ],
        evidentialStrength: 0.75,
        expectedObservableOutcome: { observed: true },
        expectedHorizon: "next_grounded_activity",
        modelRouteReceiptId: "route-receipt:c4-select",
        workingViewAssertionId: first,
        capabilityMode: "dark_apply",
      });

      expect(prediction).toMatchObject({
        ownerId: C4_OWNER,
        decisionId,
        lifecycleState: "selected",
        selected: true,
        provenance: "live",
        capabilityModeAtWrite: "dark_apply",
        workingViewAssertionId: first,
      });
      expect(prediction.evidenceRefs).toHaveLength(2);
      expect(listWorkingViewLinks(db, prediction.id)).toEqual([
        { predictionId: prediction.id, assertionId: first, linkRole: "primary_working_view" },
      ]);
    } finally {
      db.close();
    }
  });

  it("does not infer a prediction from decision outcome text or initiative learning", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const decisionId = c4Decision(db);
      setDecisionOutcome(db, decisionId, "Delivered speech is not a semantic outcome.");
      db.prepare(
        "INSERT INTO initiative_learning (owner_id, motivation_kind, adjustment, updated_at) VALUES (?, 'question', 8, ?)",
      ).run(C4_OWNER, C4_TIME_2);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM cognitive_predictions WHERE owner_id = ?",
      ).get(C4_OWNER)).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("refuses missing bounded fields, CoT markers, stale C1 evidence, and secret evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Assertion(db, "A current Ashley interest.", C4_TIME_1);
      const second = c4Assertion(db, "A later current Ashley interest.", C4_TIME_2);
      const base = {
        ownerId: C4_OWNER,
        judgmentText: "A bounded judgment.",
        judgmentClass: "interest",
        evidenceRefs: [
          { type: "assertion" as const, id: first },
          { type: "assertion" as const, id: second },
        ],
        evidentialStrength: 0.5,
        expectedObservableOutcome: "true",
        expectedHorizon: "later",
        modelRouteReceiptId: "route-receipt:test",
        workingViewAssertionId: first,
        capabilityMode: "dark_apply" as const,
      };
      expect(() => selectConsequentialPrediction(db, { ...base, expectedHorizon: "" }))
        .toThrow("cognitive_graduation_expected_horizon_required");
      expect(() => selectConsequentialPrediction(db, { ...base, judgmentText: "<think>hidden</think>" }))
        .toThrow("cognitive_graduation_chain_of_thought_refused");
      db.prepare(
        "UPDATE memory_assertions SET termination_reason = 'invalidated', authority_to = ? WHERE id = ?",
      ).run("2026-08-21T10:00:00.001Z", second);
      expect(() => selectConsequentialPrediction(db, base))
        .toThrow("cognitive_graduation_c1_evidence_not_current");
      const secret = c4Assertion(db, "A secret assertion.", C4_TIME_2, "secret");
      expect(() => selectConsequentialPrediction(db, {
        ...base,
        evidenceRefs: [
          { type: "assertion", id: first },
          { type: "assertion", id: secret },
        ],
      })).toThrow("cognitive_graduation_secret_evidence_refused");
    } finally {
      db.close();
    }
  });

  it("fails closed when a persisted C4 contract is newer than this candidate", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Assertion(db, "first", C4_TIME_1);
      const second = c4Assertion(db, "second", C4_TIME_2);
      const decisionId = c4Decision(db);
      db.prepare(
        "UPDATE cognitive_maturation_contract_state SET highest_contract_version = 2 WHERE wave = 'c4'",
      ).run();
      expect(() => selectConsequentialPrediction(db, {
        ownerId: C4_OWNER,
        decisionId,
        judgmentText: "bounded",
        judgmentClass: "interest",
        evidenceRefs: [
          { type: "assertion", id: first },
          { type: "assertion", id: second },
        ],
        evidentialStrength: 0.5,
        expectedObservableOutcome: "true",
        expectedHorizon: "later",
        modelRouteReceiptId: "route",
        workingViewAssertionId: first,
      }))
        .toThrow("cognitive_graduation_contract_unsupported:2>1");
    } finally {
      db.close();
    }
  });
});

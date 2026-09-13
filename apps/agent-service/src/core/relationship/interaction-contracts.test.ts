import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { logDecision } from "../agency/log.js";
import { recordIdentityEntry } from "../identity/store.js";
import {
  recordInteractionContract,
  transitionInteractionContract,
} from "./interaction-contracts.js";

const OWNER = "c5-contract-owner";

function decision(db: DatabaseSync): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind: "speak",
      motivationIds: [],
      score: 50,
      reason: "bounded relationship decision",
      objective: "express a bounded relationship decision",
      evidenceRefs: [],
      uncertainty: 0.2,
      urgency: 0,
      thoughtSource: "deterministic",
      thoughtError: null,
      affectLicense: {
        permitted: false,
        valence: 0,
        activation: 0.5,
        openness: 0.5,
        tension: 0,
        reason: "fixture",
      },
      cognitiveAllocation: {
        shouldSpeak: true,
        effort: "medium",
        completion: "complete",
      },
      authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
    },
  });
}

describe("C5 typed interaction contracts", () => {
  it("records the four Q16 kinds without collapsing their owners", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const ownerInstruction = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "owner_standing_instruction",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:instruction" }],
        ownerConfirmationEvidenceRef: "message:instruction",
        scope: "relationship reminders",
        audience: "Ashley",
      });
      expect(ownerInstruction.lifecycleState).toBe("recorded");
      expect(transitionInteractionContract(db, ownerInstruction.id, "in_force").lifecycleState)
        .toBe("in_force");

      const identityId = recordIdentityEntry(db, {
        ownerId: OWNER,
        layer: "stable",
        kind: "boundary.relationship",
        text: "Ashley does not perform pressure or guilt.",
        source: "manual",
      });
      const boundary = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "ashley_standing_boundary",
        classification: "never_public",
        evidenceRefs: [{ type: "identity", id: identityId }],
        identityEntryId: identityId,
        identityIntervalVersion: "identity:v1",
      });
      expect(boundary.lifecycleState).toBe("in_force");
      expect(boundary.identityEntryId).toBe(identityId);

      const mutual = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "mutual_contract",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:proposal" }],
        proposalId: "proposal:1",
      });
      expect(mutual.lifecycleState).toBe("proposed");

      const hypothesis = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "implicit_hypothesis",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:hypothesis" }],
        uncertainty: 0.8,
        typedEvidence: { influenceClass: "I2", basis: "lexical_overlap" },
      });
      expect(hypothesis.lifecycleState).toBe("hypothesis");
      expect(hypothesis.partySubjectScope).toBe("owner + ashley");
    } finally {
      db.close();
    }
  });

  it("requires exact bilateral evidence before a mutual contract can bind", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const proposed = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "mutual_contract",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:proposal" }],
        proposalId: "proposal:2",
        ownerConfirmationEvidenceRef: "message:owner-confirmed",
      });
      expect(() => transitionInteractionContract(db, proposed.id, "bilaterally_evidenced"))
        .toThrow("mutual_contract_bilateral_evidence_required");

      const decisionId = decision(db);
      const evidenced = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "mutual_contract",
        lifecycleState: "bilaterally_evidenced",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:proposal-3" }],
        proposalId: "proposal:3",
        ownerConfirmationEvidenceRef: "message:owner-confirmed-3",
        ashleyConfirmationEvidenceRef: `decision:${decisionId}`,
        ashleyDecisionId: decisionId,
      });
      expect(transitionInteractionContract(db, evidenced.id, "in_force").lifecycleState)
        .toBe("in_force");
    } finally {
      db.close();
    }
  });

  it("keeps implicit hypotheses non-binding even when transition is requested", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const hypothesis = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "implicit_hypothesis",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:similarity" }],
        uncertainty: 0.6,
      });
      expect(() => transitionInteractionContract(db, hypothesis.id, "in_force"))
        .toThrow("implicit_hypothesis_cannot_bind");
      expect(() => recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "implicit_hypothesis",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:high-influence" }],
        uncertainty: 0.1,
        typedEvidence: { influenceClass: "I3" },
      })).toThrow("implicit_hypothesis_influence_class_too_high");
      expect(() => recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "implicit_hypothesis",
        classification: "ordinary",
        evidenceRefs: [{ type: "message", id: "message:high-influence-2" }],
        uncertainty: 0.1,
        typedEvidence: { influenceClass: "I4" },
      })).toThrow("implicit_hypothesis_influence_class_too_high");
    } finally {
      db.close();
    }
  });
});

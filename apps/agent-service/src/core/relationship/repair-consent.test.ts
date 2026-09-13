import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { logDecision } from "../agency/log.js";
import { openNuclearDb } from "../db.js";
import {
  consentCurrentlyEligible,
  listCurrentConsent,
  recordConsentEvent,
} from "./consent.js";
import {
  latestRepairDisposition,
  recordRepairAdjudication,
  recordRepairEvidence,
  recordRepairProposal,
} from "./repair.js";

const OWNER = "c5-repair-owner";

function decision(db: DatabaseSync, kind: "speak" | "challenge" = "speak"): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind,
      motivationIds: [],
      score: 50,
      reason: "C5 repair decision",
      objective: "make a bounded repair decision",
      evidenceRefs: [],
      uncertainty: 0.3,
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

describe("C5 consent and repair evidence", () => {
  it("keeps Doc and Ashley consent party-specific and append-only", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const doc = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "private_relationship_projection",
        purpose: "bounded private Thought",
        evidenceOrDecisionRef: "message:doc-consent",
        classification: "ordinary",
        eventKind: "grant",
      });
      const ashley = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "ashley",
        granteeOrConsumer: "doc",
        scope: "private_relationship_projection",
        purpose: "bounded private Thought",
        evidenceOrDecisionRef: "decision:ashley-consent",
        classification: "ordinary",
        eventKind: "grant",
      });
      expect(consentCurrentlyEligible(db, doc.id)).toBe(true);
      expect(consentCurrentlyEligible(db, ashley.id)).toBe(true);

      const revoke = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "private_relationship_projection",
        purpose: "bounded private Thought",
        evidenceOrDecisionRef: "message:doc-revocation",
        classification: "ordinary",
        eventKind: "revoke",
        supersedesConsentId: doc.id,
      });
      expect(consentCurrentlyEligible(db, doc.id)).toBe(false);
      expect(consentCurrentlyEligible(db, ashley.id)).toBe(true);
      expect(listCurrentConsent(db, OWNER).map((record) => record.id)).toEqual([ashley.id]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM consent_records WHERE owner_id = ?").get(OWNER))
        .toEqual({ count: 3 });
      expect(() => db.prepare(
        "UPDATE consent_records SET purpose = 'rewritten' WHERE id = ?",
      ).run(revoke.id)).toThrow("consent_record_append_only");
      expect(() => db.prepare(
        "DELETE FROM consent_records WHERE id = ?",
      ).run(doc.id)).toThrow("consent_record_append_only");
    } finally {
      db.close();
    }
  });

  it("keeps repair proposal, evidence, adjudication, and delivery as separate facts", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const proposal = recordRepairProposal(db, {
        ownerId: OWNER,
        tensionId: null,
        proposalOrigin: "model",
        text: "Ask for clarification without pressure.",
        evidenceRefs: [{ type: "message", id: "message:misunderstanding" }],
        classification: "never_public",
      });
      const evidence = recordRepairEvidence(db, {
        ownerId: OWNER,
        proposalId: proposal.id,
        evidenceRefs: [{ type: "message", id: "message:follow-up" }],
        classification: "never_public",
      });
      const decisionId = decision(db, "challenge");
      const adjudication = recordRepairAdjudication(db, {
        ownerId: OWNER,
        proposalId: proposal.id,
        disposition: "repaired",
        adjudicatingDecisionId: decisionId,
        hostValidationOk: true,
        classification: "never_public",
        evidenceRefs: [{ type: "repair_evidence", id: evidence.entityUuid }],
        deliveryReceiptId: "delivery:expression-is-not-repair",
      });
      expect(latestRepairDisposition(db, proposal.id)?.disposition).toBe("repaired");
      expect(adjudication.deliveryReceiptId).toBe("delivery:expression-is-not-repair");
      expect(db.prepare(
        "SELECT lifecycle_state FROM repair_proposals WHERE id = ?",
      ).get(proposal.id)).toEqual({ lifecycle_state: "adjudicated" });
      expect(() => db.prepare(
        "UPDATE repair_evidence SET content_binding = 'tampered' WHERE id = ?",
      ).run(evidence.id)).toThrow("repair_evidence_append_only");
      expect(() => db.prepare(
        "DELETE FROM repair_adjudications WHERE id = ?",
      ).run(adjudication.id)).toThrow("repair_adjudication_append_only");
    } finally {
      db.close();
    }
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "../memory/assertions.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import { recomputeSharedCulture } from "./projections.js";
import { recordConsentEvent, consentCurrentlyEligible } from "./consent.js";
import {
  recordInteractionContract,
  transitionInteractionContract,
} from "./interaction-contracts.js";
import { recordAshleySelfCommitment } from "./self-commitments.js";
import { recordRelationalTension } from "./tensions.js";
import { recordRepairProposal, recordRepairAdjudication } from "./repair.js";
import { logDecision } from "../agency/log.js";
import { recordWithdrawal } from "./authority.js";
import { decide } from "../agency/decide.js";
import { collectMotivations } from "../agency/motivations.js";
import type { Decision } from "../types.js";
import { currentBuildIdentity, currentContractId } from "../rollout/capabilities.js";
import { env } from "../../env.js";
import { evaluateWithdrawalSilence } from "./repair.js";
import { listRelationshipMotivationProjections } from "./projections.js";

const OWNER = "c5-gap-owner";

function fixtureDecision(db: DatabaseSync, kind: Decision["kind"] = "speak"): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind,
      motivationIds: [],
      score: 50,
      reason: "C5 fixture decision",
      objective: "Record a bounded relationship decision.",
      evidenceRefs: [],
      uncertainty: 0.4,
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
        shouldSpeak: kind !== "silence",
        effort: "medium",
        completion: "complete",
      },
      authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
    },
  });
}

function assertion(
  db: DatabaseSync,
  subjectFacet: "owner_model" | "ashley_side",
  text: string,
  recordedAt = "2026-08-20T10:00:00.000Z",
): number {
  return insertAssertion(db, {
    ownerId: OWNER,
    kind: "owner_interpretation",
    subjectFacet,
    lineageKind: subjectFacet === "owner_model" ? "owner_designated" : "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I1",
    claimText: text,
    sourceKind: "c5_fixture",
    recordedAt,
    authorityFrom: recordedAt,
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: defaultUnclassifiedConversational(),
  });
}

function activateRelationshipCapabilities(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET state = 'active'`,
  );
  for (const capability of [
    "recall", "mind_state", "thought", "relational_initiative", "relationship_state",
  ]) {
    insert.run(capability, currentContractId(), now, now, currentContractId(), currentBuildIdentity());
  }
}

describe("C5 characterization and closing witnesses", () => {
  it("persists one current shared-culture row and keeps the prior snapshot historical", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const owner = assertion(db, "owner_model", "Doc enjoys compiler design.");
      const ashley = assertion(db, "ashley_side", "Ashley enjoys compiler design.");
      const first = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T12:00:00.000Z"),
      });
      expect(first.current).toBe(true);
      expect(first.sourceBindings.ownerAssertionIds).toContain(owner);
      expect(first.sourceBindings.ashleyAssertionIds).toContain(ashley);

      db.prepare(
        `UPDATE memory_assertions SET termination_reason = 'invalidated',
         authority_to = '2026-08-21T12:00:00.000Z'
         WHERE id = ?`,
      ).run(owner);
      const second = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-21T12:00:00.000Z"),
      });
      expect(second.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(second.sourceBindings.ashleyAssertionIds).toEqual([]);
      expect(db.prepare(
        `SELECT COUNT(*) AS count FROM relationship_projections
         WHERE owner_id = ? AND kind = 'current_shared_culture'
           AND effective_to IS NULL`,
      ).get(OWNER)).toEqual({ count: 1 });
      expect(db.prepare(
        `SELECT COUNT(*) AS count FROM relationship_projections
         WHERE owner_id = ? AND kind = 'historical_as_of'`,
      ).get(OWNER)).toEqual({ count: 1 });
      expect(first.contentBinding).not.toBe(second.contentBinding);
    } finally {
      db.close();
    }
  });

  it("requires bilateral consent and makes revocation effective in observe", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const doc = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "private_relationship_projection",
        purpose: "bounded relationship thought",
        evidenceOrDecisionRef: "message:consent-doc",
        classification: "ordinary",
        eventKind: "grant",
      });
      expect(consentCurrentlyEligible(db, doc.id)).toBe(true);
      expect(consentCurrentlyEligible(db, doc.id, { mode: "observe" })).toBe(true);
      const revoke = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "private_relationship_projection",
        purpose: "bounded relationship thought",
        evidenceOrDecisionRef: "message:revoke-doc",
        classification: "ordinary",
        eventKind: "revoke",
        supersedesConsentId: doc.id,
      });
      expect(revoke.eventKind).toBe("revoke");
      expect(consentCurrentlyEligible(db, doc.id)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("keeps implicit hypotheses non-binding and requires a decision for accepted state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const hypothesis = recordInteractionContract(db, {
        ownerId: OWNER,
        kind: "implicit_hypothesis",
        evidenceRefs: [{ type: "message", id: "message:similarity" }],
        uncertainty: 0.8,
        text: "There may be a shared interest in compilers.",
        classification: "ordinary",
      });
      expect(() => transitionInteractionContract(db, hypothesis.id, "in_force")).toThrow(
        "implicit_hypothesis_cannot_bind",
      );
      const decisionId = fixtureDecision(db);
      const self = recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Ashley will revisit compiler examples.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${decisionId}`,
        decisionId,
        evidenceRefs: [{ type: "decision", id: decisionId } as never],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
      });
      expect(self.provenance).toBe("shadow");
      expect(() => recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Model-only commitment.",
        sourceEntityType: "model",
        sourceEntityUuid: "model-only",
        evidenceRefs: [],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
      })).toThrow("relationship_decision_required");
    } finally {
      db.close();
    }
  });

  it("separates repair evidence from delivery and requires an adjudicating decision", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const tensionDecision = fixtureDecision(db, "challenge");
      const tension = recordRelationalTension(db, {
        ownerId: OWNER,
        text: "The parties may have misunderstood the scope.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${tensionDecision}`,
        decisionId: tensionDecision,
        evidenceRefs: [{ type: "decision", id: tensionDecision } as never],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
      });
      const proposal = recordRepairProposal(db, {
        ownerId: OWNER,
        tensionId: tension.id,
        proposalOrigin: "model",
        text: "Ask for clarification without pressure.",
        evidenceRefs: [{ type: "relational_tension", id: tension.entityUuid }],
        classification: "ordinary",
        capabilityMode: "observe",
      });
      expect(() => recordRepairAdjudication(db, {
        ownerId: OWNER,
        proposalId: proposal.id,
        disposition: "repaired",
        adjudicatingDecisionId: tensionDecision,
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
        deliveryReceiptId: "delivery-is-not-repair",
      })).not.toThrow();
      expect(db.prepare(
        `SELECT COUNT(*) AS count FROM repair_evidence WHERE proposal_id = ?`,
      ).get(proposal.id)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("keeps C5 shadow tensions out of Agency while preserving legacy owner-scoped rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const previousMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      const shadow = recordRelationalTension(db, {
        ownerId: OWNER,
        text: "C5 shadow tension must not become a proactive motivation.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:c5-shadow-tension",
        evidenceRefs: [{ type: "message", id: "message:c5-shadow-tension" }],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
      });

      const legacyUuid = "legacy-v14-tension";
      db.prepare(
        `INSERT INTO relational_tensions
           (owner_id, entity_uuid, data_classification, text, status, repair_status,
            linked_withdrawal_entity_uuid, last_repair_decision_id,
            source_entity_type, source_entity_uuid, evidence_json, text_hash,
            created_at, updated_at, provenance, party_subject_scope)
         VALUES (?, ?, 'ordinary', ?, 'open', 'open', NULL, NULL,
                 'legacy', ?, '[]', 'legacy-hash', ?, ?, 'shadow', 'owner')`,
      ).run(
        OWNER,
        legacyUuid,
        "Legacy owner-scoped tension remains eligible under the v14 gate.",
        "legacy-source",
        new Date().toISOString(),
        new Date().toISOString(),
      );

      const projections = listRelationshipMotivationProjections(
        db,
        OWNER,
        "proactive",
        "",
        { capabilityMode: "observe" },
      );
      expect(projections.some((item) => item.refId === shadow.entityUuid)).toBe(false);
      expect(projections.some((item) => item.refId === legacyUuid)).toBe(true);
      expect(collectMotivations(db, OWNER, "proactive", undefined, undefined, {
        persist: false,
      }).some((item) => item.refId === shadow.entityUuid)).toBe(false);
    } finally {
      env.cognitionMode = previousMode;
      db.close();
    }
  });

  it("keeps proactive withdrawal silence in the decision path", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      recordWithdrawal(db, {
        ownerId: OWNER,
        initiator: "doc",
        scope: "relationship_pause",
        reason: "Please leave me alone for now.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:space",
      });
      const result = decide([], "proactive", { db, ownerId: OWNER });
      expect(result.kind).toBe("silence");
      expect(result.silenceReasonCode).toBe("withdrawal_pause");
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("blocks initiative and topic withdrawal before proactive selection", () => {
    const initiativeDb = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      recordWithdrawal(initiativeDb, {
        ownerId: OWNER,
        initiator: "doc",
        scope: "initiative",
        reason: "Pause all proactive initiative for now.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:initiative-withdrawal",
      });
      expect(evaluateWithdrawalSilence(
        initiativeDb,
        OWNER,
        "apply",
        undefined,
        { proactive: true },
      )).toBe("withdrawal_initiative");
    } finally {
      initiativeDb.close();
    }

    const topicDb = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      recordWithdrawal(topicDb, {
        ownerId: OWNER,
        initiator: "doc",
        scope: "topic",
        topicHint: "compiler",
        reason: "Do not bring up compiler work.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:topic-withdrawal",
      });
      expect(evaluateWithdrawalSilence(
        topicDb,
        OWNER,
        "apply",
        undefined,
        { proactive: true },
      )).toBe("withdrawal_topic");
      expect(evaluateWithdrawalSilence(
        topicDb,
        OWNER,
        "apply",
        "unrelated weather",
      )).toBeNull();
      expect(evaluateWithdrawalSilence(
        topicDb,
        OWNER,
        "apply",
        "compiler examples",
      )).toBe("withdrawal_topic");
    } finally {
      topicDb.close();
    }
  });
});

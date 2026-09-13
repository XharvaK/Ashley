import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { logDecision } from "../agency/log.js";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "../memory/assertions.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import {
  consentCurrentlyEligible,
  recordConsentEvent,
} from "./consent.js";
import {
  getCurrentSharedCulture,
  listHistoricalSharedCulture,
  recomputeSharedCulture,
} from "./projections.js";
import { recordWithdrawal } from "./authority.js";
import { evaluateWithdrawalSilence } from "./repair.js";
import { withdrawMutualCommitment } from "./transitions.js";
import {
  confirmMutualAshleyDecision,
  confirmMutualDoc,
  proposeMutualCommitment,
  tryActivateMutualCommitment,
} from "./transitions.js";
import type { Decision } from "../types.js";

const OWNER = "c5-restart-owner";

function decision(db: DatabaseSync): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind: "speak" as Decision["kind"],
      motivationIds: [],
      score: 50,
      reason: "C5 non-revival decision",
      objective: "make a bounded choice",
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

function addAssertion(
  db: DatabaseSync,
  subjectFacet: "owner_model" | "ashley_side",
  text: string,
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
    sourceKind: "c5_non_revival_fixture",
    recordedAt: "2026-08-20T10:00:00.000Z",
    authorityFrom: "2026-08-20T10:00:00.000Z",
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: defaultUnclassifiedConversational(),
  });
}

describe("C5 rollback, withdrawal, and non-revival", () => {
  it("does not reactivate a withdrawn mutual contract on a later proposal or read", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const consent = {
        ownerId: OWNER,
        scope: "private_relationship_projection",
        purpose: "bounded relationship thought",
        classification: "ordinary" as const,
        capabilityMode: "dark_apply" as const,
        eventKind: "grant" as const,
      };
      recordConsentEvent(db, {
        ...consent,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        evidenceOrDecisionRef: "message:non-revival-doc-consent",
      });
      recordConsentEvent(db, {
        ...consent,
        grantorIdentityRole: "ashley",
        granteeOrConsumer: "doc",
        evidenceOrDecisionRef: "decision:non-revival-ashley-consent",
      });
      const entityUuid = proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will review the boundary together.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:non-revival",
        classification: "ordinary",
        capabilityMode: "dark_apply",
      });
      confirmMutualDoc(db, entityUuid, "message:owner-confirmation", { capabilityMode: "dark_apply" });
      const decisionId = decision(db);
      confirmMutualAshleyDecision(db, entityUuid, decisionId, undefined, { capabilityMode: "dark_apply" });
      expect(tryActivateMutualCommitment(db, entityUuid, { capabilityMode: "dark_apply" })).toBe(true);
      withdrawMutualCommitment(db, entityUuid, {
        initiator: "doc",
        evidenceRef: "message:withdrawal",
      });
      expect(tryActivateMutualCommitment(db, entityUuid, { capabilityMode: "dark_apply" })).toBe(false);
      expect(proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will review the boundary together.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:non-revival",
        classification: "ordinary",
      })).toBe(entityUuid);
      expect(db.prepare(
        "SELECT status FROM mutual_commitments WHERE entity_uuid = ?",
      ).get(entityUuid)).toEqual({ status: "released" });
    } finally {
      db.close();
    }
  });

  it("keeps consent revocation and withdrawal evidence effective when optional influence is rolled back", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const grant = recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "relationship_projection",
        purpose: "bounded Thought",
        evidenceOrDecisionRef: "message:grant",
        classification: "ordinary",
        eventKind: "grant",
        capabilityMode: "dark_apply",
      });
      recordConsentEvent(db, {
        ownerId: OWNER,
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "relationship_projection",
        purpose: "bounded Thought",
        evidenceOrDecisionRef: "message:revoke",
        classification: "ordinary",
        eventKind: "revoke",
        supersedesConsentId: grant.id,
        capabilityMode: "observe",
      });
      expect(consentCurrentlyEligible(db, grant.id, { mode: "observe" })).toBe(false);

      const withdrawalUuid = recordWithdrawal(db, {
        ownerId: OWNER,
        initiator: "doc",
        scope: "relationship_pause",
        reason: "Please leave this relationship topic alone.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:withdrawal",
      });
      expect(db.prepare(
        "SELECT status, repair_status FROM withdrawal_records WHERE entity_uuid = ?",
      ).get(withdrawalUuid)).toMatchObject({ status: "active" });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM consent_records WHERE owner_id = ?",
      ).get(OWNER)).toEqual({ count: 2 });
      expect(evaluateWithdrawalSilence(db, OWNER, "observe")).toBe("withdrawal_pause");
    } finally {
      db.close();
    }
  });

  it("keeps historical shared culture while the current projection drops corrected owner state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const ownerAssertion = addAssertion(db, "owner_model", "Doc enjoys careful repair work.");
      addAssertion(db, "ashley_side", "Ashley enjoys careful repair work.");
      recomputeSharedCulture(db, OWNER, { at: new Date("2026-08-20T12:00:00.000Z") });
      db.prepare(
        `UPDATE memory_assertions SET termination_reason = 'invalidated',
         authority_to = '2026-08-21T12:00:00.000Z' WHERE id = ?`,
      ).run(ownerAssertion);
      const afterCorrection = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-21T12:00:00.000Z"),
        capabilityMode: "observe",
      });
      expect(afterCorrection.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(getCurrentSharedCulture(db, OWNER)?.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(listHistoricalSharedCulture(db, OWNER)).toHaveLength(1);
      expect(recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-22T12:00:00.000Z"),
        capabilityMode: "observe",
      }).sourceBindings.ownerAssertionIds).toEqual([]);
      expect(listHistoricalSharedCulture(db, OWNER)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

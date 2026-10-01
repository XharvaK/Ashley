import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { AshleyCore } from "../runtime.js";
import { logDecision } from "../agency/log.js";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "../memory/assertions.js";
import { admitOwnerCorrection } from "../memory/corrections.js";
import { fanoutCorrection } from "../memory/fanout.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import { recordIdentityEntry } from "../identity/store.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { upsertMemoryAssertion } from "../cognitive-v021/memory/assertions.js";
import {
  evaluateRevisions, getRevision, listFoundationalReviews, proposeRevisions,
  recordOwnerRevisionDecision, recordRevisionPositions, revertRevision,
  revisableIdentityEntries,
} from "../cognitive-v021/growth/revisions.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import { observeReactiveRelationshipSignals } from "./authority.js";
import { recordConsentEvent } from "./consent.js";
import {
  getCurrentSharedCulture,
  recomputeSharedCulture,
  relationshipProjectionDiagnostics,
} from "./projections.js";
import { recordRepairAdjudication, recordRepairProposal } from "./repair.js";
import { recordRelationalTension } from "./tensions.js";
import {
  confirmMutualAshleyDecision,
  confirmMutualAshleyDelivery,
  confirmMutualDoc,
  proposeMutualCommitment,
  tryActivateMutualCommitment,
} from "./transitions.js";

const OWNER = "c5-settlement-owner";

function allowMutualRelationship(db: DatabaseSync): void {
  const common = {
    ownerId: OWNER,
    scope: "private_relationship_projection",
    purpose: "bounded relationship thought",
    classification: "ordinary" as const,
    eventKind: "grant" as const,
    capabilityMode: "dark_apply" as const,
  };
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "doc",
    granteeOrConsumer: "ashley",
    evidenceOrDecisionRef: "message:settlement-doc-consent",
  });
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "ashley",
    granteeOrConsumer: "doc",
    evidenceOrDecisionRef: "decision:settlement-ashley-consent",
  });
}

function seedDelivery(
  db: DatabaseSync,
  entityUuid: string,
  decisionId: number,
): void {
  db.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, decision_id, trigger, state, created_at, entity_uuid)
     VALUES (?, 'test', 'thread', ?, 'reactive', 'committed', ?, ?)` ,
  ).run(OWNER, decisionId, new Date().toISOString(), entityUuid);
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
      reason: "C5 settlement decision",
      objective: "make a bounded relationship choice",
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

function assertion(
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
    sourceKind: "c5_settlement_fixture",
    recordedAt: "2026-08-20T10:00:00.000Z",
    authorityFrom: "2026-08-20T10:00:00.000Z",
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: defaultUnclassifiedConversational(),
  });
}

describe("C5 local settlement witness", () => {
  it("recomputes the current projection through the C1 correction fan-out seam", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const ownerAssertion = assertion(db, "owner_model", "Alex enjoys careful correction work.");
      assertion(db, "ashley_side", "Ashley enjoys careful correction work.");
      recomputeSharedCulture(db, OWNER, { at: new Date("2026-08-20T12:00:00.000Z") });
      const threadId = resolveActiveThread(db, OWNER, "discord");
      const sourceMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER,
        role: "user",
        text: "The stored owner relationship fact is wrong and must be corrected.",
        channel: "discord",
      });
      const admitted = admitOwnerCorrection(db, {
        ownerId: OWNER,
        sourceMessageId,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "owner relationship fact",
        targets: [{
          assertionId: ownerAssertion,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
      });

      const result = fanoutCorrection(db, admitted.correction.id);
      expect(result.receipt.readbackOk).toBe(true);
      expect(result.readback.blockedAssertionIds).toContain(ownerAssertion);
      expect(getCurrentSharedCulture(db, OWNER)?.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
        currentCount: 1,
        historicalCount: 1,
      });
    } finally {
      db.close();
    }
  });

  for (const reverting of [false, true]) {
    it(reverting
      ? "restores shared culture bindings when a foundational revision is reverted"
      : "recomputes shared culture when an owner-authorized foundational revision applies", () => {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      const sidecar = openTestSidecar();
      try {
        const oldIdentityId = recordIdentityEntry(db, {
          ownerId: OWNER, layer: "stable", kind: "value",
          text: "Ashley values careful compiler work.", source: "manual",
        });
        assertion(db, "owner_model", "Alex values careful compiler work.");
        // Both wordings overlap: the projection must replace the entry binding.
        const text = "Ashley values careful compiler work!";
        const before = recomputeSharedCulture(db, OWNER);
        expect(before.sourceBindings.ashleyIdentityEntryIds).toContain(oldIdentityId);
        const nowMs = Date.now();
        upsertMemoryAssertion(sidecar, {
          assertionKey: "self:c5", statement: "Patient debugging matters to me.",
          memoryKind: "learned_self_evidence",
          dimensions: { source: "ashley_interpretation", status: "interpreted", time: "current", reliability: "inferred" },
          dataClassification: "ordinary", lineageParentKey: null, admittedGeneration: 1, live: true,
        });
        const proposed = proposeRevisions(sidecar, {
          cycleId: "c5-proposal", identity: revisableIdentityEntries(db, OWNER), nowMs,
          proposals: [{ layer: "value", revisesEntryId: oldIdentityId, text,
            rationale: "Owner-authorized foundational review fixture.", evidenceRefs: ["self:c5"] }],
        })[0];
        expect(proposed?.outcome).toBe("proposed");
        const revisionId = (proposed as { revisionId: number }).revisionId;
        expect(recordRevisionPositions(sidecar, {
          cycleId: "c5-affirm", positions: [{ revisionId, position: "affirm", rationale: "This wording is mine." }], nowMs: nowMs + 1,
        })).toEqual([revisionId]);
        expect(listFoundationalReviews(sidecar)).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: revisionId, proposedValue: text, ashleyPosition: "affirm" }),
        ]));
        expect(recordOwnerRevisionDecision(sidecar, { revisionId, decision: "approve", nowMs: nowMs + 2 })).toBe(true);
        const store = { nuclear: db, ownerId: OWNER };
        expect(evaluateRevisions(sidecar, store, nowMs + 2).applied).toEqual([revisionId]);
        const newIdentityId = getRevision(sidecar, revisionId)!.appliedEntryId!;
        if (reverting) {
          // Establish the post-apply projection independently to isolate revert.
          recomputeSharedCulture(db, OWNER);
          expect(getCurrentSharedCulture(db, OWNER)?.sourceBindings.ashleyIdentityEntryIds).toContain(newIdentityId);
          expect(revertRevision(sidecar, store, revisionId, nowMs + 3)).toBe(true);
          const after = getCurrentSharedCulture(db, OWNER)!;
          expect(after.sourceBindings.ashleyIdentityEntryIds).not.toContain(newIdentityId);
          expect(after.sourceBindings.ashleyIdentityEntryIds).toContain(oldIdentityId);
        } else {
          const after = getCurrentSharedCulture(db, OWNER)!;
          expect(after.sourceBindings.ashleyIdentityEntryIds).not.toContain(oldIdentityId);
          expect(after.sourceBindings.ashleyIdentityEntryIds).toContain(newIdentityId);
        }
        expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
          currentCount: 1, historicalCount: reverting ? 2 : 1,
        });
      } finally {
        sidecar.close();
        db.close();
      }
    });
  }

  it("proves bounded proposal, bilateral decision, reminder motivation, repair separation, withdrawal, and correction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const previousMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      allowMutualRelationship(db);

      const ownerAssertion = assertion(db, "owner_model", "Alex enjoys careful repair work.");
      assertion(db, "ashley_side", "Ashley enjoys careful repair work.");
      const firstProjection = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T12:00:00.000Z"),
      });
      expect(firstProjection.sourceBindings.ownerAssertionIds).toContain(ownerAssertion);

      const mutualUuid = proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will review the repair notes together.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:bounded-proposal",
        classification: "ordinary",
        capabilityMode: "dark_apply",
      });
      confirmMutualDoc(db, mutualUuid, "message:owner-explicit-confirmation", { capabilityMode: "dark_apply" });
      const ashleyDecisionId = decision(db);
      seedDelivery(db, "delivery:accepted-expression", ashleyDecisionId);
      confirmMutualAshleyDecision(db, mutualUuid, ashleyDecisionId, undefined, { capabilityMode: "dark_apply" });
      confirmMutualAshleyDelivery(db, mutualUuid, "delivery:accepted-expression", ashleyDecisionId, { capabilityMode: "dark_apply" });
      expect(tryActivateMutualCommitment(db, mutualUuid, { capabilityMode: "dark_apply" })).toBe(true);

      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Remind me to review the repair notes.",
        messageEntityUuid: "message:reminder",
        dueAt: "2026-08-20T13:00:00.000Z",
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM scheduled_proactive_messages WHERE owner_id = ?",
      ).get(OWNER)).toEqual({ count: 0 });

      const tensionDecisionId = decision(db, "challenge");
      const tension = recordRelationalTension(db, {
        ownerId: OWNER,
        text: "The scope of the repair may still be misunderstood.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${tensionDecisionId}:tension`,
        decisionId: tensionDecisionId,
        evidenceRefs: [{ type: "decision", id: tensionDecisionId }],
        hostValidationOk: true,
        classification: "never_public",
      });
      const proposal = recordRepairProposal(db, {
        ownerId: OWNER,
        tensionId: tension.id,
        proposalOrigin: "model",
        text: "Ask once for clarification without pressure.",
        evidenceRefs: [{ type: "relational_tension", id: tension.entityUuid }],
        classification: "never_public",
      });
      const adjudication = recordRepairAdjudication(db, {
        ownerId: OWNER,
        proposalId: proposal.id,
        disposition: "unresolved",
        adjudicatingDecisionId: decision(db, "challenge"),
        hostValidationOk: true,
        classification: "never_public",
        deliveryReceiptId: "delivery:not-a-repair-verdict",
      });
      expect(adjudication.disposition).toBe("unresolved");
      expect(db.prepare(
        "SELECT status FROM relational_tensions WHERE id = ?",
      ).get(tension.id)).toEqual({ status: "open" });

      const withdrawal = db.prepare(
        `SELECT entity_uuid FROM withdrawal_records WHERE owner_id = ? LIMIT 1`,
      ).get(OWNER) as { entity_uuid?: string } | undefined;
      expect(withdrawal).toBeUndefined();
      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Please leave me alone for now.",
        messageEntityUuid: "message:space",
      });

      db.prepare(
        `UPDATE memory_assertions SET termination_reason = 'invalidated',
         authority_to = '2026-08-21T12:00:00.000Z' WHERE id = ?`,
      ).run(ownerAssertion);
      const corrected = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-21T12:00:00.000Z"),
      });
      expect(corrected.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
        currentCount: 1,
        historicalCount: 1,
      });
    } finally {
      env.cognitionMode = previousMode;
      db.close();
    }
  });
});

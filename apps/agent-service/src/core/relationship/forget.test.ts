import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { forgetOwnerTopic, forgetOwnerTopicImmediate } from "../memory/forget.js";
import { upsertDocReminder } from "./store.js";
import { logDecision } from "../agency/log.js";
import type { Decision } from "../types.js";
import { recordConsentEvent } from "./consent.js";
import { recordInteractionContract } from "./interaction-contracts.js";
import { recomputeSharedCulture } from "./projections.js";
import { recordRepairAdjudication, recordRepairProposal } from "./repair.js";
import { recordRelationalTension } from "./tensions.js";

function fixtureDecision(db: DatabaseSync): number {
  const decision: Decision = {
    trigger: "reactive",
    kind: "challenge",
    motivationIds: [],
    score: 50,
    reason: "C5 forget fixture decision",
    objective: "Record a bounded repair decision.",
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
  };
  return logDecision(db, {
    ownerId: "doc",
    channel: "test",
    trigger: "reactive",
    decision,
  });
}

describe("relationship forget", () => {
  it("includes relationship rows in preview and redacts on apply", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const uuid = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Secret garden watering schedule",
      dueAt: null,
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
      classification: "ordinary",
    });
    const preview = forgetOwnerTopic(db, "doc", "garden watering", false, {
      continuity,
    });
    expect(preview.preview.some((line) => line.includes("doc_reminder"))).toBe(
      true,
    );
    const applied = forgetOwnerTopicImmediate(
      db,
      "doc",
      "garden watering",
      continuity,
    );
    expect(applied.previewId).toBeTruthy();
    const row = db
      .prepare(`SELECT text, status FROM doc_reminders WHERE entity_uuid = ?`)
      .get(uuid) as { text?: string; status?: string };
    expect(row.text).toBe("[redacted]");
    expect(row.status).toBe("cancelled");
    db.close();
    continuity.close();
  });

  it("invalidates C5 dependent state without mutating append-only evidence", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    try {
      const tension = recordRelationalTension(db, {
        ownerId: "doc",
        text: "Garden watering repair remains unresolved.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:garden-watering",
        evidenceRefs: [{ type: "message", id: "message:garden-watering" }],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "observe",
      });
      const proposal = recordRepairProposal(db, {
        ownerId: "doc",
        tensionId: tension.id,
        proposalOrigin: "owner",
        text: "Garden watering repair proposal.",
        evidenceRefs: [
          { type: "relational_tension", id: tension.entityUuid },
          { type: "topic", id: "garden watering" },
        ],
        classification: "ordinary",
        capabilityMode: "observe",
      });
      const adjudication = recordRepairAdjudication(db, {
        ownerId: "doc",
        proposalId: proposal.id,
        disposition: "unresolved",
        adjudicatingDecisionId: fixtureDecision(db),
        hostValidationOk: true,
        classification: "ordinary",
        evidenceRefs: [{ type: "topic", id: "garden watering" }],
        capabilityMode: "observe",
      });
      const contract = recordInteractionContract(db, {
        ownerId: "doc",
        kind: "owner_standing_instruction",
        scope: "garden watering",
        audience: "owner",
        ownerConfirmationEvidenceRef: "message:garden-watering",
        evidenceRefs: [{ type: "message", id: "garden watering" }],
        classification: "ordinary",
        text: "Keep the garden watering discussion bounded.",
      });
      const docConsent = recordConsentEvent(db, {
        ownerId: "doc",
        grantorIdentityRole: "doc",
        granteeOrConsumer: "ashley",
        scope: "private_relationship_projection",
        purpose: "garden watering projection",
        evidenceOrDecisionRef: "message:garden watering",
        classification: "ordinary",
        eventKind: "grant",
      });
      const ashleyConsent = recordConsentEvent(db, {
        ownerId: "doc",
        grantorIdentityRole: "ashley",
        granteeOrConsumer: "doc",
        scope: "private_relationship_projection",
        purpose: "garden watering projection",
        evidenceOrDecisionRef: "decision:garden watering",
        classification: "ordinary",
        eventKind: "grant",
      });
      recomputeSharedCulture(db, "doc");

      const preview = forgetOwnerTopic(db, "doc", "garden watering", false, { continuity });
      expect(preview.categoryCounts?.interaction_contract).toBe(1);
      expect(preview.categoryCounts?.consent_record).toBe(2);
      expect(preview.categoryCounts?.repair_evidence).toBe(1);
      expect(preview.categoryCounts?.repair_adjudication).toBe(1);
      expect(preview.preview.some((line) => line.includes("repair_proposal"))).toBe(true);

      const applied = forgetOwnerTopicImmediate(db, "doc", "garden watering", continuity);
      expect(applied.receiptId).toBeTruthy();
      expect(db.prepare(
        "SELECT lifecycle_state, effective_to FROM interaction_contracts WHERE entity_uuid = ?",
      ).get(contract.entityUuid)).toMatchObject({ lifecycle_state: "withdrawn" });
      expect(db.prepare(
        "SELECT event_kind FROM consent_records WHERE supersedes_consent_id = ?",
      ).all(docConsent.id)).toHaveLength(1);
      expect(db.prepare(
        "SELECT event_kind FROM consent_records WHERE supersedes_consent_id = ?",
      ).all(ashleyConsent.id)).toHaveLength(1);
      expect(db.prepare(
        "SELECT lifecycle_state, repair_text FROM repair_proposals WHERE id = ?",
      ).get(proposal.id)).toEqual({ lifecycle_state: "withdrawn", repair_text: "[redacted]" });
      const evidenceRow = db.prepare(
        "SELECT id FROM repair_evidence WHERE proposal_id = ?",
      ).get(proposal.id) as { id?: number } | undefined;
      const evidenceId = evidenceRow?.id;
      expect(evidenceId).toBeTypeOf("number");
      if (evidenceId == null) throw new Error("repair_evidence_fixture_missing");
      expect(db.prepare("SELECT COUNT(*) AS count FROM repair_evidence WHERE id = ?").get(
        evidenceId,
      )).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM repair_adjudications WHERE id = ?").get(
        adjudication.id,
      )).toEqual({ count: 1 });
      expect(db.prepare("SELECT repair_status FROM relational_tensions WHERE id = ?").get(
        tension.id,
      )).toEqual({ repair_status: "none" });
      expect(db.prepare(
        `SELECT source_bindings_json FROM relationship_projections
         WHERE owner_id = ? AND kind = 'current_shared_culture' AND effective_to IS NULL`,
      ).get("doc")).toMatchObject({ source_bindings_json: expect.any(String) });
      const current = db.prepare(
        `SELECT source_bindings_json FROM relationship_projections
         WHERE owner_id = ? AND kind = 'current_shared_culture' AND effective_to IS NULL`,
      ).get("doc") as { source_bindings_json?: string };
      expect(JSON.parse(current.source_bindings_json ?? "{}")).toMatchObject({
        ownerAssertionIds: [],
        ashleyAssertionIds: [],
      });
    } finally {
      db.close();
      continuity.close();
    }
  });
});

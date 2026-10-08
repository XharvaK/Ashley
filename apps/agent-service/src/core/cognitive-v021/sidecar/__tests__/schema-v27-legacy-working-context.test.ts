import { describe, expect, it } from "vitest";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { listWorkingContext, applyWorkingContextDelta } from "../../evidence/working-context.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

function prepareV25WorkingContextShape(db: ReturnType<typeof openTestSidecar>): void {
  setTestSidecarVersion(db, 25);
}

describe("cognitive sidecar Schema V27 legacy Working Context", () => {
  it("marks v25 topics for review while preserving their historical fields and text", () => {
    const db = openTestSidecar();
    const originalPayload = {
      type: "topic",
      text: "Keep this topic until further notice.",
      concernId: null,
      sourceTurnIds: ["turn-legacy-1"],
      status: "active",
      supersedesId: null,
    };
    try {
      prepareV25WorkingContextShape(db);
      db.prepare(
        `INSERT INTO working_context_items
           (id, conversation_id, type, payload_json, superseded, updated_cycle, updated_generation)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run("e1a31488", "thread-legacy", "topic", JSON.stringify(originalPayload), "cycle-before-v26", 13);
      db.prepare(
        `INSERT INTO working_context_items
           (id, conversation_id, type, payload_json, superseded, updated_cycle, updated_generation)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run("teaching-before-v26", "thread-legacy", "owner_teaching", JSON.stringify({
        type: "owner_teaching",
        text: "Owner teaching with a stored private audience.",
        concernId: null,
        sourceTurnIds: ["turn-legacy-2"],
        status: "active",
        supersedesId: null,
        audienceScope: { kind: "owner_private" },
      }), "cycle-before-v26", 12);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(75);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 75 });
      const stored = db.prepare(
        `SELECT payload_json, superseded, updated_cycle, updated_generation,
                applicability_lifecycle, audience_state, legacy_scope
           FROM working_context_items WHERE id = ?`,
      ).get("e1a31488") as Record<string, unknown>;
      expect(JSON.parse(String(stored.payload_json))).toEqual(originalPayload);
      expect(stored).toMatchObject({
        superseded: 0,
        updated_cycle: "cycle-before-v26",
        updated_generation: 13,
        applicability_lifecycle: "needs_review",
        audience_state: "unknown",
        legacy_scope: "legacy_unknown_scope",
      });

      const [legacy] = listWorkingContext(db, "thread-legacy");
      expect(legacy).toMatchObject({
        id: "e1a31488",
        text: "Keep this topic until further notice.",
        sourceTurnIds: ["turn-legacy-1"],
        status: "active",
        applicabilityLifecycle: "needs_review",
        legacyScope: "legacy_unknown_scope",
        audienceScope: null,
      });
      expect(JSON.stringify(legacy)).not.toContain("untilMs");
      expect(JSON.stringify(legacy)).not.toContain("expired");
      expect(db.prepare(
        `SELECT applicability_lifecycle, audience_state, legacy_scope
           FROM working_context_items WHERE id = ?`,
      ).get("teaching-before-v26")).toEqual({
        applicability_lifecycle: "needs_review",
        audience_state: "known",
        legacy_scope: "legacy_unknown_scope",
      });

      db.prepare("UPDATE working_context_items SET applicability_lifecycle = 'current' WHERE id = ?")
        .run("e1a31488");
      const [staleProjection] = listWorkingContext(db, "thread-legacy");
      expect(staleProjection).toMatchObject({ applicabilityLifecycle: "needs_review" });
    } finally {
      db.close();
    }
  });

  it("keeps a newly published verified directive current after the v27 migration", () => {
    const db = openTestSidecar();
    try {
      const text = "Keep the explicit boundary for this conversation.";
      const evidence = appendOwnerUtterance(db, {
        conversationId: "thread-new-directive",
        text,
        discordMessageIds: ["message-after-v27"],
        nowMs: 10,
      });
      const evidenceId = evidence.rowId;

      applyWorkingContextDelta(db, {
        op: "upsert",
        item: {
          id: "wc-after-v27",
          conversationId: "thread-new-directive",
          type: "topic",
          text: "The explicit boundary remains current.",
          concernId: null,
          sourceTurnIds: [evidenceId],
          status: "active",
          supersedesId: null,
          interpretationEnvelope: {
            kind: "directive_interpretation",
            support: [{ kind: "conversation_text_span", evidenceRowId: evidenceId, start: 0, end: text.length, quote: text }],
            audience: { kind: "owner_private" },
            applicability: { subject: "Ashley", target: "this conversation", conversationId: "thread-new-directive" },
            boundaryBasis: { temporal: "explicit_in_source" },
            applicabilityInterval: { fromMs: 10, untilMs: 100 },
            conditions: { text: "", unresolved: false },
            derivationParents: [],
            revisionOf: null,
            revisionEvidenceRefs: [],
          },
        },
      }, { cycleId: "cycle-after-v27", generation: 27, nowMs: 20 });

      const [current] = listWorkingContext(db, "thread-new-directive");
      expect(current).toMatchObject({
        id: "wc-after-v27",
        interpretationEnvelope: {
          boundaryBasis: { temporal: "explicit_in_source" },
          applicabilityLifecycle: "current",
          support: [{ kind: "conversation_text_span", evidenceRowId: evidenceId, quote: text }],
        },
      });
    } finally {
      db.close();
    }
  });
});

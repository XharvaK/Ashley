import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar Schema V30 interpretation dependencies", () => {
  it("creates the dependency table and backfills typed source and revision edges from v29", () => {
    const db = openTestSidecar();
    try {
      const payload = {
        type: "owner_teaching",
        text: "The interpretation text.",
        concernId: null,
        sourceTurnIds: [],
        status: "active",
        supersedesId: null,
        interpretationEnvelope: {
          kind: "descriptive_belief",
          support: [{
            kind: "conversation_text_span",
            evidenceRowId: "evidence:v30",
            start: 0,
            end: 6,
            quote: "source",
          }],
          audience: { kind: "unknown" },
          applicability: { subject: "Ashley", target: "this conversation", conversationId: "thread:v30" },
          boundaryBasis: { temporal: "unknown" },
          applicabilityInterval: { until: "unknown" },
          conditions: { text: "", unresolved: false },
          derivationParents: ["wc:parent"],
          revisionOf: "wc:prior",
          revisionEvidenceRefs: [{
            kind: "conversation_text_span",
            evidenceRowId: "evidence:revision:v30",
            start: 0,
            end: 6,
            quote: "source",
          }],
          owningRecordId: "wc:current",
          revision: 4,
          authoringCycleId: "cycle:v30",
          supportAvailability: "intact",
          attribution: { principalKind: "owner", principalId: "owner:v30" },
          sourceTimeMs: 1,
          interpretationTimeMs: 2,
          applicabilityLifecycle: "current",
        },
      };
      db.prepare(
        `INSERT INTO working_context_items
           (id, conversation_id, type, payload_json, superseded, updated_cycle, updated_generation,
            applicability_lifecycle, audience_state, legacy_scope)
         VALUES ('wc:current', 'thread:v30', 'owner_teaching', ?, 0, 'cycle:v30', 4, 'current', 'unknown', NULL)`,
      ).run(JSON.stringify(payload));
      db.exec("DROP INDEX IF EXISTS idx_interpretation_dependencies_target");
      db.exec("DROP TABLE IF EXISTS interpretation_dependencies");
      setTestSidecarVersion(db, 29);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(31);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 31 });
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get())
        .toMatchObject({ schema_version: 31 });
      expect(db.prepare("PRAGMA table_info(interpretation_dependencies)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "from_id" }),
        expect.objectContaining({ name: "to_id" }),
        expect.objectContaining({ name: "kind" }),
      ]));
      expect(db.prepare("SELECT from_id, to_id, kind FROM interpretation_dependencies ORDER BY to_id").all()).toEqual([
        { from_id: "wc:current", to_id: "conversation_evidence:evidence:revision:v30", kind: "support" },
        { from_id: "wc:current", to_id: "conversation_evidence:evidence:v30", kind: "support" },
        { from_id: "wc:current", to_id: "working_context:wc:parent", kind: "revision" },
        { from_id: "wc:current", to_id: "working_context:wc:prior", kind: "revision" },
      ]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_interpretation_dependencies_target")).toEqual({ name: "idx_interpretation_dependencies_target" });
    } finally {
      db.close();
    }
  });
});

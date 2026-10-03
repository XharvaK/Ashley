import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar Schema V31 typed support refs", () => {
  it("adds nullable memory support refs and additive JSON arrays to concerns and desk entries", () => {
    const db = openTestSidecar();
    try {
      setTestSidecarVersion(db, 51);
      // Preserve a real typed influence fixture while rewinding unrelated v31 support columns.
      const influenceDDL = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='learned_influences'").get()!.sql);
      const insertInfluence = () => db.exec(`INSERT INTO learned_influences
        (id,entity_uuid,owner_id,kind,subject_facet,semantic_owner,semantic_owner_ref,lineage_kind,
         influence_class,text,content_hash,proposal_lifecycle,adjudication_state,provenance,
         capability_mode_at_write,data_classification,classification_source,created_at,updated_at)
        VALUES(1,'fixture:influence','fixture:owner','interest','ashley_side','memory_evidence',
         'interest:fixture','ashley_native','I1','Fixture interest','sha256:fixture',
         'proposed','pending','shadow','observe','never_public','copied','fixture','fixture')`);
      insertInfluence();
      const learnedInfluenceCountBefore = (db.prepare("SELECT COUNT(*) AS count FROM learned_influences").get() as { count: number }).count;
      db.prepare(
        `INSERT INTO sidecar_memory_supports
           (support_id, assertion_key, source, provenance, source_architecture_epoch, source_ref,
            settlement_id, evidence_lineage_id, observation_id, receipt_id, dimensions_json,
            data_classification, created_at_ms)
         VALUES ('support:legacy-v30', 'assertion:legacy-v30', 'owner_utterance', 'native', 'v0.2.1',
            'turn:legacy-v30', NULL, NULL, NULL, NULL, '{}', 'never_public', 1)`,
      ).run();
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key,
            cognitive_status, quarantine_kind, forgotten, snapshot_hash, updated_cycle)
         VALUES ('concern:legacy-v30', 'thread:legacy-v30', 'Legacy concern', '["turn:legacy-v30"]',
            '{}', NULL, 'active', NULL, 0, 'hash:legacy-v30', 'cycle:legacy-v30')`,
      ).run();
      db.prepare(
        `INSERT INTO desk_entries
           (id, concern_ref, body, author_kind, source_refs_json, verbatim, form, endorsement_ref,
            audience_scope_json, lifecycle, superseded_by, updated_cycle, updated_generation, created_at_ms, updated_at_ms)
         VALUES ('desk:legacy-v30', NULL, 'Legacy note', 'ashley', '[]', 0, 'note', NULL,
            '{"kind":"owner_private"}', 'active', NULL, 'cycle:legacy-v30', 1, 1, 1)`,
      ).run();
      setTestSidecarVersion(db, 30);
      db.exec(influenceDDL);
      insertInfluence();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      const columnNames = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
      expect(columnNames("working_context_items")).toContain("applicability_lifecycle");
      for (const table of ["sidecar_memory_supports", "sidecar_memory_assertions", "concerns", "desk_entries"]) {
        expect(columnNames(table)).not.toContain("applicability_lifecycle");
      }
      expect((db.prepare("SELECT COUNT(*) AS count FROM learned_influences").get() as { count: number }).count)
        .toBe(learnedInfluenceCountBefore);

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(61);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 61 });
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get())
        .toMatchObject({ schema_version: 61 });
      expect(db.prepare("SELECT support_ref_json FROM sidecar_memory_supports WHERE support_id = 'support:legacy-v30'").get())
        .toEqual({ support_ref_json: null });
      expect(db.prepare("SELECT source_refs_json, support_refs_json FROM concerns WHERE concern_id = 'concern:legacy-v30'").get())
        .toEqual({ source_refs_json: '["turn:legacy-v30"]', support_refs_json: "[]" });
      expect(db.prepare("SELECT source_refs_json, support_refs_json FROM desk_entries WHERE id = 'desk:legacy-v30'").get())
        .toEqual({ source_refs_json: "[]", support_refs_json: "[]" });
      expect(() => db.prepare("UPDATE concerns SET support_refs_json = ? WHERE concern_id = ?").run("not-json", "concern:legacy-v30"))
        .toThrow();
      expect(() => db.prepare("UPDATE sidecar_memory_supports SET support_ref_json = ? WHERE support_id = ?").run("not-json", "support:legacy-v30"))
        .toThrow();
    } finally {
      db.close();
    }
  });
});

// Distinct mechanical choice kinds keep separate receipts without changing influence authority.
import { describe, expect, it } from "vitest";
import { openTestSidecar, admitTestCycle, setTestSidecarVersion } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_V51 } from "../schema.js";
function fixture() {
  const db = openTestSidecar();
  db.exec(`INSERT INTO learned_influences (entity_uuid,owner_id,kind,subject_facet,semantic_owner,semantic_owner_ref,
    lineage_kind,influence_class,text,content_hash,proposal_lifecycle,adjudication_state,provenance,
    capability_mode_at_write,data_classification,classification_source,created_at,updated_at)
    VALUES ('fixture:influence','fixture:owner','interest','ashley_side','thought','interest:fixture',
      'ashley_native','I1','fixture','sha256:fixture','proposed','pending','live','observe','ordinary','copied','fixture:time','fixture:time')`);
  const id = Number(db.prepare("SELECT id FROM learned_influences").get()!.id);
  admitTestCycle(db, { cycleId: "fixture:cycle", conversationId: "fixture:conversation", generation: 1,
    triggerKind: "idle_opportunity", triggerRef: "fixture:cycle", nowMs: 100 });
  const receipt = (receiptId: string, kind: string) => db.prepare(`INSERT INTO learned_choice_receipts
    (receipt_id,owner_id,learned_id,choice_kind,candidate_ids_json,selected_ids_json,rank_delta_json,policy_binding,
     reason_code,input_content_hash,output_content_hash,eligible_input_affected_ranking,agency_made_final_choice,
     data_classification,created_at,cycle_id,counterfactual_ids_json)
    VALUES (?,'fixture:owner',?,?,'[]','[]','{}','fixture:policy','fixture:reason','sha256:input','sha256:output',
      0,0,'ordinary','fixture:time','fixture:cycle','[]')`).run(receiptId,id,kind);
  return { db, receipt };
}
function legacy(db: ReturnType<typeof openTestSidecar>) {
  const rows = db.prepare("SELECT * FROM learned_choice_receipts").all();
  const create = COGNITIVE_SIDECAR_SCHEMA_V51.match(/CREATE TABLE IF NOT EXISTS learned_choice_receipts \([\s\S]*?\n\);/)![0];
  db.exec("DROP TRIGGER learned_influence_delete_children; DROP TABLE learned_choice_receipts");
  db.exec(create);
  db.exec(`ALTER TABLE learned_choice_receipts ADD COLUMN cycle_id TEXT REFERENCES cycle_records(cycle_id);
    ALTER TABLE learned_choice_receipts ADD COLUMN counterfactual_ids_json TEXT CHECK(counterfactual_ids_json IS NULL OR json_valid(counterfactual_ids_json));
    CREATE UNIQUE INDEX idx_learned_choice_receipts_cycle ON learned_choice_receipts(learned_id,cycle_id) WHERE cycle_id IS NOT NULL;
    CREATE TRIGGER learned_influence_delete_children BEFORE DELETE ON learned_influences BEGIN
      DELETE FROM learned_choice_receipts WHERE learned_id=OLD.id;
      DELETE FROM learned_influence_evidence WHERE learned_influence_id=OLD.id;
    END;`);
  for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO learned_choice_receipts (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...Object.values(row));
  }
  setTestSidecarVersion(db, 54);
}
describe("sidecar curiosity receipt storage", () => {
  it("declares curiosity kind and distinct-kind cycle uniqueness", () => {
    const { db } = fixture(); try {
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='learned_choice_receipts'").get()!.sql).toContain("curiosity_rank");
      expect(db.prepare("PRAGMA index_info(idx_learned_choice_receipts_cycle)").all().map(row => row.name))
        .toEqual(["learned_id", "cycle_id", "choice_kind"]);
    } finally { db.close(); }
  });
  it("records agenda and curiosity once each in the same actual cycle", () => {
    const { db, receipt } = fixture(); try {
      receipt("agenda", "agenda_order");
      expect(() => receipt("curiosity", "curiosity_rank")).not.toThrow();
      expect(() => receipt("repeat", "curiosity_rank")).toThrow();
      expect(db.prepare("SELECT count(*) AS n FROM learned_choice_receipts").get()!.n).toBe(2);
    } finally { db.close(); }
  });
  it("preserves complete legacy rows and observe authority during upgrade", () => {
    const { db, receipt } = fixture(); try {
      receipt("legacy", "agenda_order"); legacy(db);
      const before = db.prepare("SELECT * FROM learned_choice_receipts").all();
      const authority = db.prepare("SELECT * FROM influence_contract_state").all();
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT * FROM learned_choice_receipts").all()).toEqual(before);
      expect(db.prepare("SELECT * FROM influence_contract_state").all()).toEqual(authority);
      expect(() => receipt("curiosity", "curiosity_rank")).not.toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT count(*) AS n FROM learned_choice_receipts").get()!.n).toBe(2);
    } finally { db.close(); }
  });
  it("rolls back a rejected copy without discarding legacy evidence", () => {
    const { db, receipt } = fixture(); try {
      receipt("legacy", "agenda_order"); legacy(db);
      db.exec("PRAGMA ignore_check_constraints=ON; UPDATE learned_choice_receipts SET data_classification='invalid'; PRAGMA ignore_check_constraints=OFF");
      const before = db.prepare("SELECT * FROM learned_choice_receipts").all();
      expect(() => openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } })).toThrow();
      expect(db.prepare("PRAGMA user_version").get()!.user_version).toBe(54);
      expect(db.prepare("SELECT * FROM learned_choice_receipts").all()).toEqual(before);
    } finally { db.close(); }
  });
});

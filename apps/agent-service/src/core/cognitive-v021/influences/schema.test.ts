// Influence storage separates receipts and derived bindings from execution authority.
import { describe, expect, it } from "vitest";
import { openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
const tables=["learned_influences","learned_influence_evidence","learned_choice_receipts","interest_touches","influence_contract_state"];
const names=(db:ReturnType<typeof openTestSidecar>)=>db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
describe("A5a sidecar influence storage",()=>{
 it("creates three ported stores, per-cycle touches and observe contract state",()=>{
  const db=openTestSidecar();try{
   expect(names(db)).toEqual(expect.arrayContaining(tables));
   expect(db.prepare("SELECT highest_contract_version,state,live_authority_existed FROM influence_contract_state WHERE id=1").get()).toEqual({highest_contract_version:1,state:"observe",live_authority_existed:0});
   expect(db.prepare("PRAGMA user_version").get()).toEqual({user_version:59});
   expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
   expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>row.name)).toEqual(expect.arrayContaining([
    "idx_learned_influences_owner_state","idx_learned_influences_entity_uuid",
    "idx_learned_influence_evidence_learned","idx_learned_influence_evidence_assertion",
    "idx_learned_choice_receipts_owner_created","idx_learned_choice_receipts_learned_created",
   ]));
   expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='learned_choice_receipts'").get()!.sql).toContain("agenda_order");
  }finally{db.close();}
 });
 it("upgrades v50 without backfilling branch touch history",()=>{
  const db=openTestSidecar();try{
   setTestSidecarVersion(db,50);
   db.prepare("INSERT INTO interest_branches (branch_id,root,label,origin,lived_count,created_at_ms,last_lived_at_ms) VALUES ('technology/compilers','Technology','compilers','ashley',9,1,1)").run();
   openCognitiveSidecarDb(db,{dataPlane:{kind:"isolated"}});
   expect(names(db)).toEqual(expect.arrayContaining(tables));
   expect(db.prepare("SELECT * FROM interest_touches").all()).toEqual([]);
   expect(db.prepare("SELECT lived_count FROM interest_branches WHERE branch_id='technology/compilers'").get()).toEqual({lived_count:9});
   expect(db.prepare("PRAGMA user_version").get()).toEqual({user_version:59});
  }finally{db.close();}
 });
});

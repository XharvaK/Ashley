// Empty legacy C3 retirement cannot erase active relationship contract truth.
import { DatabaseSync } from "node:sqlite";
import { describe,expect,it } from "vitest";
import { openNuclearDb,NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { getContinuityFor } from "../continuity/registry.js";
import { restoreLegacyV55Objects } from "./__tests__/fixtures/legacy-v55.js";
import { assertC5ContractCompatible,c5CapabilityState } from "../relationship/c5-contract-state.js";
import { getCurrentSharedCulture,recomputeSharedCulture } from "../relationship/projections.js";
const tables=["learned_influences","learned_influence_evidence","learned_choice_receipts","identity_seed_lineage"];
function legacy(db:DatabaseSync){restoreLegacyV55Objects(db);db.exec("PRAGMA user_version=55");getContinuityFor(db)!.exec("UPDATE lineage_state SET nuclear_schema_version=55 WHERE id=1");}
function objects(db:DatabaseSync){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();}
describe("nuclear56 C3 retirement",()=>{
 it("drops empty C3/shared state without manufacturing a third identity or shared-culture organ",()=>{
  const db=openNuclearDb(new DatabaseSync(":memory:"));try{
   expect(NUCLEAR_SUPPORTED_VERSION).toBe(56);expect(db.prepare("PRAGMA user_version").get()).toEqual({user_version:56});
   for(const table of [...tables,"cognitive_maturation_contract_state","identity_similarity","shared_culture"])expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeUndefined();
   expect(()=>assertC5ContractCompatible(db)).not.toThrow();expect(getCurrentSharedCulture(db,"fixture-owner")).toBeNull();
   expect(()=>recomputeSharedCulture(db,"fixture-owner")).not.toThrow();expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{db.close();}
 });
 it("preserves every C5 marker field unchanged and keeps future-version and authority refusals",()=>{
  const db=openNuclearDb(new DatabaseSync(":memory:"));try{
   legacy(db);db.exec("UPDATE cognitive_maturation_contract_state SET event_highwater=17,state='dark_apply',cutover_or_activation_state='fixture_history' WHERE wave='c5'");
   const before=db.prepare("SELECT * FROM cognitive_maturation_contract_state WHERE wave='c5'").get();openNuclearDb(db);
   expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='relationship_contract_state'").get()).toBeTruthy();
   expect(db.prepare("SELECT * FROM relationship_contract_state WHERE wave='c5'").get()).toEqual(before);expect(c5CapabilityState(db)).toBe("dark_apply");
   db.exec("UPDATE relationship_contract_state SET highest_contract_version=2");expect(()=>assertC5ContractCompatible(db)).toThrow("relational_graduation_contract_unsupported:2>1");
   db.exec("UPDATE relationship_contract_state SET highest_contract_version=1,live_authority_existed=1");expect(()=>assertC5ContractCompatible(db)).toThrow("relational_graduation_live_authority_unexpected");
  }finally{db.close();}
 });
 it.each(tables)("refuses rows in %s before any DDL or continuity update",table=>{
  const db=openNuclearDb(new DatabaseSync(":memory:"));try{
   legacy(db);db.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
   const cols=db.prepare(`PRAGMA table_info(${table})`).all().filter(r=>Number(r.notnull)===1||Number(r.pk)===1);
   db.prepare(`INSERT INTO ${table} (${cols.map(r=>r.name).join(",")}) VALUES (${cols.map(()=>"?").join(",")})`).run(...cols.map(r=>/INT|REAL/i.test(String(r.type))?1:"fixture"));
   db.exec("PRAGMA ignore_check_constraints=OFF; PRAGMA foreign_keys=ON");
   const before=objects(db),rows=db.prepare(`SELECT * FROM ${table}`).all(),c=getContinuityFor(db)!,lineage=c.prepare("SELECT * FROM lineage_state").all(),events=c.prepare("SELECT * FROM continuity_events").all();
   expect(()=>openNuclearDb(db)).toThrow(`c3_rows_present:${table}:1`);expect(objects(db)).toEqual(before);expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows);
   expect(db.prepare("PRAGMA user_version").get()).toEqual({user_version:55});expect(c.prepare("SELECT * FROM lineage_state").all()).toEqual(lineage);expect(c.prepare("SELECT * FROM continuity_events").all()).toEqual(events);
  }finally{db.close();}
 });
});

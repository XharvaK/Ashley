// C3 retirement removes empty legacy storage; C5 keeps its unchanged contract truth.
import type { DatabaseSync } from "node:sqlite";
import { C3_TABLES } from "./legacy-learned-migration-37.js";
export function assertC3TablesEmpty(db:DatabaseSync):void {
 for(const table of C3_TABLES){const row=db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!;if(Number(row.n)!==0)throw new Error(`c3_rows_present:${table}:${row.n}`);}
 for(const row of db.prepare("SELECT * FROM cognitive_maturation_contract_state WHERE wave!='c5'").all()){
  if(Number(row.highest_contract_version)!==1||Number(row.live_authority_existed)!==0||Number(row.event_highwater)!==0||row.state!=="observe"||row.cutover_or_activation_state!=="observe")throw new Error(`c3_retirement_contract_state_not_empty:${row.wave}`);
 }
 const c5=db.prepare("SELECT * FROM cognitive_maturation_contract_state WHERE wave='c5'").get();
 if(!c5||Number(c5.highest_contract_version)!==1||Number(c5.live_authority_existed)!==0)throw new Error("c3_retirement_c5_contract_unsupported");
}
export function ensureNuclearV56Schema(db:DatabaseSync):void {
 assertC3TablesEmpty(db);
 db.exec(`CREATE TABLE relationship_contract_state (
 wave TEXT PRIMARY KEY CHECK(wave='c5'), highest_contract_version INTEGER NOT NULL CHECK(highest_contract_version>=1),
 live_authority_existed INTEGER NOT NULL CHECK(live_authority_existed IN (0,1)), event_highwater INTEGER NOT NULL CHECK(event_highwater>=0),
 cutover_or_activation_state TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('observe','dark_apply','apply'))
 ); INSERT INTO relationship_contract_state SELECT * FROM cognitive_maturation_contract_state WHERE wave='c5';`);
 for(const table of ["learned_choice_receipts","learned_influence_evidence","identity_seed_lineage","learned_influences"])db.exec(`DROP TABLE ${table}`);
 db.exec("DROP TABLE cognitive_maturation_contract_state");validateNuclearV56Schema(db);
}
export function validateNuclearV56Schema(db:DatabaseSync):void {
 for(const table of [...C3_TABLES,"cognitive_maturation_contract_state"]){if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error(`nuclear_schema_content_invalid:v56:removed_table:${table}`);}
 const columns=db.prepare("PRAGMA table_info(relationship_contract_state)").all().map(r=>r.name);
 for(const name of ["wave","highest_contract_version","live_authority_existed","event_highwater","cutover_or_activation_state","state"])if(!columns.includes(name))throw new Error(`nuclear_schema_content_invalid:v56:missing_c5_column:${name}`);
 const row=db.prepare("SELECT * FROM relationship_contract_state WHERE wave='c5'").get();
 if(!row||Number(row.highest_contract_version)!==1||Number(row.live_authority_existed)!==0)throw new Error("nuclear_schema_content_invalid:v56:c5_marker");
}

// Eligibility reads facts without changing either store; refresh owns lifecycle writes.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { isLearnedInfluenceEligible, refreshLearnedInfluenceEligibility } from "../../learned-autonomy/eligibility.js";
import { admitAndAccept, c1Assertion, evidence, OWNER_ID } from "../../learned-autonomy/test-fixtures.js";
import { openTestSidecar } from "../test-support.js";

// Parent replay uses the old implementation to falsify its implicit read mutation and store ownership.
const port = await import("./" + "eligibility.js").catch(() => null);
const read = port?.readEligibility ?? ((_:DatabaseSync,id:number,options:{evidenceDb:DatabaseSync;mode?:string;at?:Date}) => isLearnedInfluenceEligible(options.evidenceDb,id,options.mode as "dark_apply",options.at));
const refresh = port?.refreshEligibility ?? ((_:DatabaseSync,id:number,options:{evidenceDb:DatabaseSync;at?:Date}) => refreshLearnedInfluenceEligibility(options.evidenceDb,id,options.at));
function fixture(){
 const db=openTestSidecar(),nuclear=openNuclearDb(new DatabaseSync(":memory:"));
 const first=c1Assertion(nuclear,{text:"compilers",observedAt:"2026-08-01T00:00:00.000Z"});
 const second=c1Assertion(nuclear,{text:"toolchains",observedAt:"2026-08-02T00:00:00.000Z"});
 const learned=admitAndAccept(nuclear,[evidence(first,"2026-08-01T00:00:00.000Z"),evidence(second,"2026-08-02T00:00:00.000Z")]);
 for(const table of ["learned_influences","learned_influence_evidence"]){
  for(const row of nuclear.prepare(`SELECT * FROM ${table}`).all()){
   const columns=Object.keys(row);db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
  }
 }
 const options={evidenceDb:nuclear,mode:"dark_apply" as const,at:new Date("2026-10-01T12:00:00Z")};
 return {db,nuclear,first,learned,options};
}
function stored(db:DatabaseSync,id:number){return db.prepare("SELECT contradiction_state FROM learned_influences WHERE id=?").get(id);}
function spyWrites(db:DatabaseSync,writes:string[]){
 const prepare=db.prepare.bind(db),exec=db.exec.bind(db);
 vi.spyOn(db,"exec").mockImplementation(sql=>{writes.push(sql);return exec(sql);});
 vi.spyOn(db,"prepare").mockImplementation(sql=>{
  const statement=prepare(sql),run=statement.run.bind(statement);
  vi.spyOn(statement,"run").mockImplementation((...args)=>{writes.push(sql);return run(...args);});
  return statement;
 });
}
describe("A5a pure C3 eligibility",()=>{
 it("makes a corrected C1 assertion ineligible with zero writes to either database",()=>{
  const {db,nuclear,first,learned,options}=fixture();try{
   nuclear.prepare("UPDATE memory_assertions SET termination_reason='invalidated' WHERE id=?").run(first);
   const writes:string[]=[];spyWrites(db,writes);spyWrites(nuclear,writes);
   expect(read(db,learned.id,options)).toBe(false);
   expect(writes).toEqual([]);
   expect(stored(db,learned.id)).toEqual({contradiction_state:"none"});
   expect(stored(nuclear,learned.id)).toEqual({contradiction_state:"none"});
  }finally{vi.restoreAllMocks();db.close();nuclear.close();}
 });
 it("records C1 correction only through explicit sidecar refresh",()=>{
  const {db,nuclear,first,learned,options}=fixture();try{
   expect(read(db,learned.id,options)).toBe(true);
   nuclear.prepare("UPDATE memory_assertions SET termination_reason='invalidated' WHERE id=?").run(first);
   refresh(db,learned.id,options);
   expect(stored(db,learned.id)).toEqual({contradiction_state:"owner_corrected"});
   expect(stored(nuclear,learned.id)).toEqual({contradiction_state:"none"});
   expect(read(db,learned.id,options)).toBe(false);
  }finally{db.close();nuclear.close();}
 });
 it("does not revive a demoted influence or mutate it on observe reads",()=>{
  const {db,nuclear,learned,options}=fixture();try{
   db.prepare("UPDATE learned_influences SET contradiction_state='demoted' WHERE id=?").run(learned.id);
   expect(read(db,learned.id,options)).toBe(false);
   refresh(db,learned.id,options);
   expect(stored(db,learned.id)).toEqual({contradiction_state:"demoted"});
   expect(read(db,learned.id,{...options,mode:"observe"})).toBe(false);
  }finally{db.close();nuclear.close();}
 });
 it("fails closed on a newer sidecar influence contract rather than the nuclear marker",()=>{
  const {db,nuclear,learned,options}=fixture();try{
   db.exec("UPDATE influence_contract_state SET highest_contract_version=2 WHERE id=1");
   expect(()=>read(db,learned.id,options)).toThrow("learned_autonomy_contract_unsupported:2>1");
  }finally{db.close();nuclear.close();}
 });
 it("uses sidecar evidence bindings and refuses cross-Owner assertion substitution",()=>{
  const {db,nuclear,learned,options}=fixture();try{
   const other=c1Assertion(nuclear,{text:"other",observedAt:"2026-08-01T00:00:00Z"});
   nuclear.prepare("UPDATE memory_assertions SET owner_id='another-owner' WHERE id=?").run(other);
   db.prepare("UPDATE learned_influence_evidence SET assertion_id=? WHERE learned_influence_id=? AND id=(SELECT min(id) FROM learned_influence_evidence)").run(other,learned.id);
   expect(read(db,learned.id,options)).toBe(false);
   expect(stored(db,learned.id)).toEqual({contradiction_state:"none"});
   expect(OWNER_ID).toBe(learned.ownerId);
  }finally{db.close();nuclear.close();}
 });
});

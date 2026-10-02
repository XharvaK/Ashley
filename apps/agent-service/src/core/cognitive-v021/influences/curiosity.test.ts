// Curiosity changes only current admitted branch salience; receipts are explicit mechanical comparisons.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordInterestTouches, forgetInterestBranch } from "../memory/interests.js";
import { recordGrowth } from "../growth/growth.js";
const T=Date.UTC(2026,9,1,12), OWNER="fixture:agenda-owner";
function fixture() {
  const db=openTestSidecar(),nuclear=openNuclearDb(new DatabaseSync(":memory:")),identityStore={nuclear,ownerId:OWNER};
  const admit=(cycleId:string,n:number,triggerKind="idle_opportunity")=>admitTestCycle(db,{cycleId,conversationId:"fixture:agenda",generation:n+1,triggerKind:triggerKind as any,triggerRef:cycleId,nowMs:T+n});
  for(let n=1;n<=3;n++){
    admit("basis"+n,n);const [key]=recordInterestTouches(db,[{root:"Technology",branch:"compilers"}],T+n);
    db.prepare("INSERT INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(key,"basis"+n,T+n);
  }
  recordGrowth(db,{cycleId:"basis3",identityStore,dataClassification:"ordinary",nowMs:T+3});
  const id=Number(db.prepare("SELECT id FROM learned_influences WHERE branch_key='technology/compilers'").get()!.id);
  admit("position",4);recordGrowth(db,{cycleId:"position",identityStore,dataClassification:"ordinary",nowMs:T+5,claim:{influencePositions:[{influenceId:id,position:"admit",rationale:"A continuing interest."}]}} as any);
  for(let n=0;n<20;n++)recordInterestTouches(db,[{root:"Technology",branch:"systems"}],T+5);
  admit("agenda",6);
  return {db,nuclear,id,admit,identityStore};
}

const inputs = [
 {eventId:"systems",observedAtMs:T+6,refs:["fixture:systems"],subscriptionId:"fixture:subscription",subscriptionCurrent:true,novelty:0.55,interestMatch:1,branchKey:"technology/systems"},
 {eventId:"compilers",observedAtMs:T+6,refs:["fixture:compilers"],subscriptionId:"fixture:subscription",subscriptionCurrent:true,novelty:0.5,interestMatch:1,branchKey:"technology/compilers"},
];
async function rank() {
 const module=await import(/* @vite-ignore */ "./curiosity.js").catch(()=>null);
 expect(module,"curiosity recorder must exist").not.toBeNull();
 return module!.recordInfluencedCuriosityRank;
}
const context={cycleId:"agenda",ownerId:OWNER};
const receipts=(db:ReturnType<typeof openTestSidecar>)=>db.prepare("SELECT * FROM learned_choice_receipts WHERE choice_kind='curiosity_rank'").all();
describe("T2 curiosity influence receipts",()=>{
 it("keeps observe and dark apply salience/order unchanged while recording counterfactual once",async()=>{
  const call=await rank(),f=fixture();try{
   const actual=call(f.db,inputs,context,T+6);
   expect(actual.map(c=>[c.eventId,c.salience])).toEqual([["systems",0.55],["compilers",0.5]]);
   expect(receipts(f.db)).toHaveLength(1);
   const r=receipts(f.db)[0];expect(r).toMatchObject({learned_id:f.id,cycle_id:"agenda",choice_kind:"curiosity_rank",eligible_input_affected_ranking:0,agency_made_final_choice:0});
   expect(JSON.parse(String(r.counterfactual_ids_json))).toEqual(["compilers","systems"]);
   expect(r.input_content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
   expect(r.output_content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
   call(f.db,inputs,context,T+6);expect(receipts(f.db)).toHaveLength(1);
   f.db.exec("UPDATE influence_contract_state SET state='dark_apply'");f.admit("dark",8);
   expect(call(f.db,inputs,{...context,cycleId:"dark"},T+8)).toEqual(actual);
   expect(receipts(f.db)).toHaveLength(2);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("uses bounded gain only in apply and retains candidate identity and evidence",async()=>{
  const call=await rank(),f=fixture();try{
   f.db.exec("UPDATE influence_contract_state SET state='apply'");const actual=call(f.db,inputs,context,T+6);
   expect(actual.map(c=>[c.eventId,c.salience])).toEqual([["compilers",0.625],["systems",0.55]]);
   expect(actual[0].refs).toEqual(inputs[1].refs);
   expect(receipts(f.db)[0]).toMatchObject({eligible_input_affected_ranking:1,agency_made_final_choice:0});
   expect(JSON.parse(String(receipts(f.db)[0].rank_delta_json))).toEqual({systems:-1,compilers:1});
   expect(inputs[1].novelty).toBe(0.5);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("excludes Owner/admitting cycles and noncurrent subscriptions without inventing eligibility",async()=>{
  const call=await rank(),f=fixture();try{
   f.db.exec("UPDATE influence_contract_state SET state='apply'");f.admit("owner",7,"owner_message");
   expect(call(f.db,inputs,{...context,cycleId:"owner"},T+7).map(c=>c.salience)).toEqual([0.55,0.5]);
   call(f.db,inputs,{...context,cycleId:"position"},T+6);
   expect(call(f.db,inputs.map(i=>({...i,subscriptionCurrent:false})),context,T+6)).toEqual([]);
   expect(receipts(f.db)).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("reads current eligibility without lifecycle writes and removes forgotten branch effects",async()=>{
  const call=await rank(),f=fixture();try{
   f.db.exec("UPDATE influence_contract_state SET state='apply',live_authority_existed=1");
   f.db.exec("UPDATE learned_influences SET contradiction_state='owner_corrected'");
   const before=f.db.prepare("SELECT * FROM learned_influences").all();
   expect(call(f.db,inputs,context,T+6).map(c=>c.salience)).toEqual([0.55,0.5]);
   expect(f.db.prepare("SELECT * FROM learned_influences").all()).toEqual(before);expect(receipts(f.db)).toEqual([]);
   forgetInterestBranch(f.db,"technology/compilers");call(f.db,inputs,context,T+6);expect(receipts(f.db)).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("fails before receipts on unsupported contract or conflicting candidate identity",async()=>{
  const call=await rank(),f=fixture();try{
   expect(()=>call(f.db,[...inputs,{...inputs[0],novelty:0.1}],context,T+6)).toThrow("curiosity_candidate_identity_conflict");
   f.db.exec("UPDATE influence_contract_state SET highest_contract_version=99");
   expect(()=>call(f.db,inputs,context,T+6)).toThrow("learned_autonomy_contract_unsupported");expect(receipts(f.db)).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("holds other admitted bindings fixed in each comparison and keeps agenda receipts separate",async()=>{
  const call=await rank(),f=fixture();try{
   for(let n=10;n<=12;n++){
    f.admit("other"+n,n);const [key]=recordInterestTouches(f.db,[{root:"Technology",branch:"systems"}],T+n);
    f.db.prepare("INSERT INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(key,"other"+n,T+n);
   }
   recordGrowth(f.db,{cycleId:"other12",identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+12});
   const otherId=Number(f.db.prepare("SELECT id FROM learned_influences WHERE branch_key='technology/systems'").get()!.id);
   f.admit("other-position",13);recordGrowth(f.db,{cycleId:"other-position",identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+14,
    claim:{influencePositions:[{influenceId:otherId,position:"admit",rationale:"A second fixture interest."}]}});
   f.admit("both",15);
   call(f.db,inputs,{...context,cycleId:"both"},T+15);
   const rs=receipts(f.db);expect(rs).toHaveLength(2);
   expect(rs[0].candidate_ids_json).not.toBe(rs[1].candidate_ids_json);
   expect(rs[0].counterfactual_ids_json).toBe(rs[1].counterfactual_ids_json);
   const {buildInnerAgenda}=await import("../initiative/agenda.js");
   buildInnerAgenda(f.db,{sinceMs:0} as any,T+15,{...context,cycleId:"both"});
   expect(f.db.prepare("SELECT count(*) AS n FROM learned_choice_receipts WHERE cycle_id='both'").get()!.n).toBe(4);
   expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("rolls back explicit receipts on write rejection without changing admission",async()=>{
  const call=await rank(),f=fixture();try{
   const before=f.db.prepare("SELECT * FROM learned_influences").all();
   f.db.exec("CREATE TRIGGER reject_curiosity BEFORE INSERT ON learned_choice_receipts WHEN NEW.choice_kind='curiosity_rank' BEGIN SELECT RAISE(ABORT,'fixture_reject'); END");
   expect(()=>call(f.db,inputs,context,T+6)).toThrow("fixture_reject");
   expect(receipts(f.db)).toEqual([]);expect(f.db.prepare("SELECT * FROM learned_influences").all()).toEqual(before);
   f.db.exec("DROP TRIGGER reject_curiosity");call(f.db,inputs,context,T+6);expect(receipts(f.db)).toHaveLength(1);
  }finally{f.db.close();f.nuclear.close();}
 });

});

// Observe compares ordering without using it; apply needs current later-pass admission.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle, makeSemanticSettlement } from "../test-support.js";
import { recordInterestTouches, forgetInterestBranch } from "../memory/interests.js";
import { recordGrowth } from "../growth/growth.js";
import { buildInnerAgenda } from "../initiative/agenda.js";
import { tickAwake, AWAKE_FIRST_DELAY_MS } from "../initiative/awake.js";
import { runCognitiveCycle } from "../thought/run.js";
import type { CapabilityReality, KernelDeps } from "../types.js";
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
const pass={sinceMs:0} as any;
const receipt=(db:ReturnType<typeof openTestSidecar>)=>db.prepare("SELECT * FROM learned_choice_receipts").all();
const keys=(agenda:ReturnType<typeof buildInnerAgenda>)=>agenda.interests.branches.map(b=>b.branch);
describe("A5b own-time agenda receipts",()=>{
 it("binds the real AWAKE kernel agenda receipt to its admitted cycle and configured Owner",async()=>{
  const f=fixture(),attentionDb=openTestSidecar(),nowMs=T+100;
  const capabilityReality={vision:false,attachmentText:false,conversationalRead:false,webSearch:false,canOfferProjectInspection:false,canOfferWorkspace:false,canOfferVerification:false,canOfferAuthorship:false,canOfferBoundedOperation:false,canOfferInquiry:false,canOfferPatchExport:false,approvedProjectIds:[]} satisfies CapabilityReality;
  const completeChat=vi.fn<KernelDeps["completeChat"]>(async()=>({text:JSON.stringify(makeSemanticSettlement({speech:{mode:"none"},commitments:{}})),model:"fixture",modelAlias:"fixture",resolvedModelId:null}));
  const deps={identityOwnerId:OWNER,nowMs:()=>nowMs,attentionDb,completeChat,runPerception:vi.fn(async()=>[]),executeObservation:vi.fn(),executeEffect:vi.fn(),checkAuthority:()=>({ok:true}),
   loadAuthorityPacks:()=>({epistemic:{allowInferredWorldClaims:false},currentness:{requireObservationForLatest:true},receipt:{receiptsByEffectId:{}},capability:capabilityReality,operational:{sandboxAvailable:false},relational:{withdrawalActive:false,neverMention:[]},stateEpoch:{authorityEpoch:1}}),
   expressionEnabled:false,projectOutbox:vi.fn(async()=>undefined),constitution:{constitutional:["truth first"],stableSelf:["curious"]},capabilityReality} satisfies KernelDeps;
  const thought=async(input:{event:import("../types.js").InboxEvent|null})=>runCognitiveCycle(f.db,f.nuclear,input.event!,deps);
  try{
   expect(await tickAwake(f.db,{conversationId:"fixture:kernel-agenda",occupantId:OWNER,authorityEpoch:1,nowMs:nowMs-AWAKE_FIRST_DELAY_MS,thought})).toMatchObject({outcome:"scheduled"});
   expect(await tickAwake(f.db,{conversationId:"fixture:kernel-agenda",occupantId:OWNER,authorityEpoch:1,nowMs,thought})).toMatchObject({outcome:"ran"});
   const cycle=f.db.prepare("SELECT cycle_id FROM cycle_records WHERE trigger_ref='awake:1'").get()!;
   expect(receipt(f.db)).toHaveLength(1);expect(receipt(f.db)[0]).toMatchObject({cycle_id:cycle.cycle_id,owner_id:OWNER,eligible_input_affected_ranking:0});
  }finally{attentionDb.close();f.db.close();f.nuclear.close();}
 });
 it("compares each binding with and without it while holding other admissions fixed",()=>{
  const f=fixture();try{
   for(let n=10;n<=12;n++){
    f.admit("other"+n,n);const [key]=recordInterestTouches(f.db,[{root:"Technology",branch:"a-first"}],T+n);
    f.db.prepare("INSERT INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(key,"other"+n,T+n);
   }
   recordGrowth(f.db,{cycleId:"other12",identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+12});
   const otherId=Number(f.db.prepare("SELECT id FROM learned_influences WHERE branch_key='technology/a-first'").get()!.id);
   f.admit("other-position",13);recordGrowth(f.db,{cycleId:"other-position",identityStore:f.identityStore,dataClassification:"ordinary",nowMs:T+14,claim:{influencePositions:[{influenceId:otherId,position:"admit",rationale:"Another continuing interest."}]}});
   f.admit("two-agenda",15);const baseline=buildInnerAgenda(f.db,pass,T+15);
   expect((buildInnerAgenda as any)(f.db,pass,T+15,{cycleId:"two-agenda",ownerId:OWNER})).toEqual(baseline);
   const rs=receipt(f.db);expect(rs).toHaveLength(2);
   expect(rs[0].candidate_ids_json).not.toBe(rs[1].candidate_ids_json);
   expect(rs[0].counterfactual_ids_json).toBe(rs[1].counterfactual_ids_json);
   expect(rs[0].selected_ids_json).toBe(rs[1].selected_ids_json);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("keeps observe ordering exact while recording both baseline and counterfactual once",()=>{
  const f=fixture();try{
   const baseline=buildInnerAgenda(f.db,pass,T+6);
   const observed=(buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"agenda",ownerId:OWNER});
   expect(observed).toEqual(baseline);expect(keys(baseline).slice(0,2)).toEqual(["systems","compilers"]);
   expect(receipt(f.db)).toHaveLength(1);
   const r=receipt(f.db)[0];expect(JSON.parse(String(r.counterfactual_ids_json)).slice(0,2)).toEqual(["technology/compilers","technology/systems"]);
   expect(r).toMatchObject({cycle_id:"agenda",learned_id:f.id,choice_kind:"agenda_order",eligible_input_affected_ranking:0,agency_made_final_choice:0});
   expect(r.candidate_ids_json).toBe(r.selected_ids_json);
   expect(r.input_content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);expect(r.output_content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
   const deltas=JSON.parse(String(r.rank_delta_json));expect(deltas["technology/compilers"]).toBe(1);
   expect(Object.values(deltas).every(value=>Number.isInteger(value)&&Math.abs(Number(value))<=15)).toBe(true);
   const columns=f.db.prepare("PRAGMA table_info(learned_choice_receipts)").all().map(row=>row.name);
   expect(columns).not.toContain("before_json");expect(columns).not.toContain("after_json");
   (buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"agenda",ownerId:OWNER});expect(receipt(f.db)).toHaveLength(1);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("uses only the admitted-branch reorder in apply without changing membership or other agenda fields",()=>{
  const f=fixture();try{
   const baseline=buildInnerAgenda(f.db,pass,T+6);f.db.exec("UPDATE influence_contract_state SET state='apply'");
   const applied=(buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"agenda",ownerId:OWNER});
   expect(keys(applied).slice(0,2)).toEqual(["compilers","systems"]);
   expect([...keys(applied)].sort()).toEqual([...keys(baseline)].sort());
   expect({...applied,interests:baseline.interests}).toEqual(baseline);
   expect(receipt(f.db)[0]).toMatchObject({eligible_input_affected_ranking:1,agency_made_final_choice:0});
   expect(JSON.parse(String(receipt(f.db)[0].selected_ids_json))).toEqual(JSON.parse(String(receipt(f.db)[0].counterfactual_ids_json)));
   const lifecycle=f.db.prepare("SELECT contradiction_state,proposal_lifecycle,adjudication_state,qualified_at FROM learned_influences WHERE id=?").get(f.id);
   f.db.exec("UPDATE influence_contract_state SET state='observe'");f.admit("rollback-agenda",9);
   expect((buildInnerAgenda as any)(f.db,pass,T+9,{cycleId:"rollback-agenda",ownerId:OWNER})).toEqual(buildInnerAgenda(f.db,pass,T+9));
   expect(f.db.prepare("SELECT contradiction_state,proposal_lifecycle,adjudication_state,qualified_at FROM learned_influences WHERE id=?").get(f.id)).toEqual(lifecycle);
   expect(receipt(f.db)).toHaveLength(2);
   forgetInterestBranch(f.db,"technology/compilers");expect(receipt(f.db)).toEqual([]);
   expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("keeps dark apply observational and refuses Owner-message or admitting-cycle effects",()=>{
  const f=fixture();try{
   const baseline=buildInnerAgenda(f.db,pass,T+6);f.db.exec("UPDATE influence_contract_state SET state='dark_apply'");
   expect((buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"agenda",ownerId:OWNER})).toEqual(baseline);expect(receipt(f.db)).toHaveLength(1);
   f.db.exec("UPDATE influence_contract_state SET state='apply'");f.admit("owner",7,"owner_message");
   expect((buildInnerAgenda as any)(f.db,pass,T+7,{cycleId:"owner",ownerId:OWNER})).toEqual(buildInnerAgenda(f.db,pass,T+7));
   expect((buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"position",ownerId:OWNER})).toEqual(baseline);
   expect(receipt(f.db)).toHaveLength(1);
  }finally{f.db.close();f.nuclear.close();}
 });
 it("fails closed on a future influence contract before recording or applying an order",()=>{
  const f=fixture();try{
   f.db.exec("UPDATE influence_contract_state SET highest_contract_version=99");
   expect(()=>(buildInnerAgenda as any)(f.db,pass,T+6,{cycleId:"agenda",ownerId:OWNER})).toThrow("learned_autonomy_contract_unsupported");
   expect(receipt(f.db)).toEqual([]);
  }finally{f.db.close();f.nuclear.close();}
 });
});

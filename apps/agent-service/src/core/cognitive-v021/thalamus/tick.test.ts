import {describe,expect,it} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {readThoughtAttention} from "./store.js";
const T=1000;
const context={budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:0.5,tension:0,circadianPhase:0};
const candidate={eventId:"fixture:reflection",observedAtMs:T,source:"reflective",salience:1,class:"ALWAYS_THROUGH",coalesceKey:"reflection",passType:"afterglow",refs:["private-note-must-not-be-copied"]};
async function run(db:ReturnType<typeof openTestSidecar>,overrides:Record<string,unknown>={}){
 // An absent entry point represents the parent revision's absence of arbitration, without a collection error.
 const module=await import("./tick.js").catch(()=>null);
 return module?.tick(db,{ownerId:"owner",conversationId:"fixture:owner",nowMs:T,enabled:true,candidates:[candidate],facts:[],context,execute:async()=>null,...overrides} as any) ?? null;
}
describe("T4 durable tick",()=>{
 it("applies a structured watch only to the fact's own candidate",async()=>{
  const db=openTestSidecar();try{
   db.prepare("INSERT INTO attention_watches(owner_id,watch_id,match_json,action,expires_json,note,created_at_ms) VALUES (?,?,?,?,?,?,?)")
    .run("owner","watch",JSON.stringify({source:"external",kind:"item",object:1,predicate:"eq"}),"suppress",JSON.stringify({atMs:T+1000}),"private",T);
   const first={...candidate,source:"external",class:"PRESSURE",passType:"own_time",eventId:"first",coalesceKey:"first"};
   const second={...first,eventId:"second",coalesceKey:"second"};
   const result=await run(db,{candidates:[first,second],facts:[{eventId:"first",source:"external",kind:"item",object:1},{eventId:"second",source:"external",kind:"item",object:2}]});
   expect(result).toMatchObject({decision:{kind:"fire",bundle:[{eventId:"second"}],pending:[{eventId:"first",suppressed:true}]}});
  }finally{db.close();}
 });
 it("rolls back checkpoint and expiry if the decision receipt cannot be written",async()=>{
  const db=openTestSidecar();try{
   db.prepare("INSERT INTO attention_watches(owner_id,watch_id,match_json,action,expires_json,note,created_at_ms) VALUES (?,?,?,?,?,?,?)")
    .run("owner","expired",JSON.stringify({source:"external",kind:"item",object:1,predicate:"eq"}),"wake",JSON.stringify({atMs:T}),"private",T-1);
   db.exec("CREATE TRIGGER fixture_reject BEFORE INSERT ON thalamus_decisions BEGIN SELECT RAISE(ABORT,'fixture_receipt_rejected'); END");
   await expect(run(db)).rejects.toThrow("fixture_receipt_rejected");
   expect(db.prepare("SELECT count(*) AS n FROM thalamus_state").get()!.n).toBe(0);
   expect(db.prepare("SELECT count(*) AS n FROM attention_watches").get()!.n).toBe(1);
  }finally{db.close();}
 });
 it("records a complete timing decision and binds its causes to the admitted cycle before execution",async()=>{
  const db=openTestSidecar();try{
   let calls=0;
   const result=await run(db,{execute:async(decision:unknown,bind:(cycleId:string)=>void)=>{
    calls++;const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"idle_opportunity",triggerRef:"fixture:pass",nowMs:T});
    bind(cycle.cycleId);
    expect(readThoughtAttention(db,"owner",cycle.cycleId,T).wokeBecause).toMatchObject([{eventId:candidate.eventId}]);
    return "ran";
   }});
   expect(result).toMatchObject({decision:{kind:"fire",passType:"afterglow"},execution:"ran"});expect(calls).toBe(1);
   const receipt=db.prepare("SELECT candidates_json,cycle_id FROM thalamus_decisions").get()!;
   expect(receipt.cycle_id).toBeTruthy();expect(String(receipt.candidates_json)).not.toContain(candidate.refs[0]);
   expect(JSON.parse(String(receipt.candidates_json)).evaluation).toMatchObject({stateBefore:{lastNowMs:0},context:{energy:0.5,budgetAvailable:true}});
   expect(db.prepare("SELECT count(*) AS n FROM thalamus_state").get()!.n).toBe(1);
  }finally{db.close();}
 });
 it("records holds and prevents mandatory pressure from bypassing a live Owner cycle",async()=>{
  const db=openTestSidecar();try{
   admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"owner_message",triggerRef:"owner",nowMs:T});
   let calls=0;const result=await run(db,{execute:async()=>{calls++;}});
   expect(result).toMatchObject({decision:{kind:"none",reason:"conversation"}});expect(calls).toBe(0);
   expect(db.prepare("SELECT decision_code,reason_code FROM thalamus_decisions").get()).toMatchObject({decision_code:"none",reason_code:"conversation"});
  }finally{db.close();}
 });
 it("keeps the kill switch free of new state and executor effects",async()=>{
  const db=openTestSidecar();try{
   let calls=0;expect(await run(db,{enabled:false,execute:async()=>{calls++;}})).toMatchObject({kind:"disabled"});
   expect(calls).toBe(0);expect(db.prepare("SELECT count(*) AS n FROM thalamus_decisions").get()!.n).toBe(0);
  }finally{db.close();}
 });
});

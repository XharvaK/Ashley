import {describe,it,expect} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {DatabaseSync} from "node:sqlite";
import {appendOwnerUtterance} from "../evidence/conversation-log.js";
const T=1000,context={budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:.5,tension:0,circadianPhase:0};
async function run(db:ReturnType<typeof openTestSidecar>,options:any){
 const module=await import("./integration.js").catch(()=>null);return module?.runThalamusPass(db,options) ?? null;
}
const candidate=(eventId:string,source="prospective",passType="own_time")=>({eventId,source,passType,coalesceKey:eventId,observedAtMs:T,class:"ALWAYS_THROUGH",salience:1,refs:[]});
describe("one arbitration, one selected executor",()=>{
 it("routes current reflection facts through the actual manager method",async()=>{
  const {AgentManager}=await import("../../../agent.js");
  const prior=process.env.ASHLEY_THALAMUS_ENABLED;process.env.ASHLEY_THALAMUS_ENABLED="true";
  const db=openTestSidecar(),nuclear=new DatabaseSync(":memory:");
  try{
   nuclear.exec("CREATE TABLE mem_threads(id TEXT,owner_id TEXT,status TEXT,channel TEXT,created_at TEXT,updated_at TEXT); INSERT INTO mem_threads VALUES('fixture:owner','owner','active','discord','a','a')");
   for(let i=0;i<40;i++)appendOwnerUtterance(db,{conversationId:"fixture:owner",text:"private fixture",nowMs:100+i,audienceAtCapture:"owner_private"});
   const manager=Object.create(AgentManager.prototype) as any;
   expect(typeof manager.tickCognitiveThalamus).toBe("function");
   manager.openCognitiveSidecar=()=>db;manager.cognitiveDeps={};manager.core={getDatabase:()=>nuclear};manager.dataPlane={};
   let calls=0;manager.tickCognitiveAfterglow=async(owner:string,now:number,selected:any)=>{
    calls++;expect(owner).toBe("owner");expect(now).toBe(1000000);expect(selected.timing).toBe("thalamus");
    const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:owner,triggerKind:"idle_opportunity",triggerRef:"reflection",nowMs:now});selected.bind(cycle.cycleId);return {outcome:"ran"};
   };
   expect(await manager.tickCognitiveThalamus("owner",1000000,true)).toMatchObject({decision:{passType:"afterglow"},execution:{outcome:"ran"}});
   expect(calls).toBe(1);
  }finally{db.close();nuclear.close();if(prior===undefined)delete process.env.ASHLEY_THALAMUS_ENABLED;else process.env.ASHLEY_THALAMUS_ENABLED=prior;}
 });
 it("selects one prospective obligation and binds its real admission",async()=>{
  const db=openTestSidecar();try{
   const calls:any[]=[];const idle=async(selection:any,selected:any)=>{calls.push(selection);const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"idle_opportunity",triggerRef:"selected",nowMs:T});selected.bind(cycle.cycleId);return "ran";};
   const result=await run(db,{ownerId:"owner",conversationId:"fixture:owner",nowMs:T,enabled:true,candidates:[candidate("trigger:a"),candidate("trigger:b")],facts:[],context,
    executors:{idle,awake:()=>{throw new Error("wrong executor");}}});
   expect(result).toMatchObject({execution:"ran"});expect(calls).toEqual([{triggerId:"a"}]);
   expect(db.prepare("SELECT cycle_id FROM thalamus_decisions").get()!.cycle_id).toBeTruthy();
  }finally{db.close();}
 });
 it("disabled ownership invokes no executor or collector effects",async()=>{
  const db=openTestSidecar();try{
   let calls=0;const result=await run(db,{ownerId:"owner",conversationId:"fixture:owner",nowMs:T,enabled:false,candidates:[candidate("reflection","reflective","afterglow")],facts:[],context,executors:{afterglow:()=>{calls++;}}});
   expect(result).toMatchObject({kind:"disabled"});expect(calls).toBe(0);expect(db.prepare("SELECT count(*) AS n FROM thalamus_decisions").get()!.n).toBe(0);
  }finally{db.close();}
 });
 it("keeps the periodic AWAKE gate distinct from independent timing families",async()=>{
  const {AgentManager}=await import("../../../agent.js"),prior=process.env.ASHLEY_THALAMUS_ENABLED;process.env.ASHLEY_THALAMUS_ENABLED="true";
  const db=openTestSidecar(),nuclear=new DatabaseSync(":memory:");try{
   nuclear.exec("CREATE TABLE mem_threads(id TEXT,owner_id TEXT,status TEXT,channel TEXT,created_at TEXT,updated_at TEXT); INSERT INTO mem_threads VALUES('fixture:owner','owner','active','discord','a','a')");
   db.prepare("INSERT INTO inner_state(conversation_id,next_awake_at_ms,last_awake_at_ms,awake_slot,updated_at_ms) VALUES('fixture:owner',0,1,0,1)").run();
   const manager=Object.create(AgentManager.prototype) as any;manager.openCognitiveSidecar=()=>db;manager.cognitiveDeps={};manager.core={getDatabase:()=>nuclear};manager.dataPlane={};
   let awake=0;manager.tickCognitiveAwake=async()=>{awake++;return {outcome:"ran"};};
   const result=await manager.tickCognitiveThalamus("owner",14400001,false,false);
   expect(awake).toBe(0);expect(result.decision.kind).toBe("none");
  }finally{db.close();nuclear.close();if(prior===undefined)delete process.env.ASHLEY_THALAMUS_ENABLED;else process.env.ASHLEY_THALAMUS_ENABLED=prior;}
 });

});

it("selects a staged operator result through the actual prospective executor",async()=>{
 const {configureSelfChangeBudget}=await import("../growth/self-change.js");
 const {selectSelfChangeResult}=await import("../growth/self-change-results.js");
 const {createHash}=await import("node:crypto");
 const db=openTestSidecar();try{
  configureSelfChangeBudget(db,{limit:3,version:1});
  const value={version:1,changesetId:"cs_timing",proposalCommit:"a".repeat(40),manifestSha256:"b".repeat(64),outcome:"accepted",decidedAtMs:10,decisionRef:"fixture",summary:"Operator observation"};
  const json=JSON.stringify(value);
  db.prepare("INSERT INTO self_change_result_receipts (changeset_id,conversation_id,result_digest,result_json,received_at_ms) VALUES (?,?,?,?,?)").run(value.changesetId,"fixture:owner",createHash("sha256").update(json).digest("hex"),json,11);
  const result=await run(db,{ownerId:"owner",conversationId:"fixture:owner",nowMs:T,enabled:true,candidates:[candidate("self-result:cs_timing")],facts:[],context,
   executors:{idle:()=>{throw new Error("ordinary executor");},selfChangeResult:async(changesetId:string,selected:any)=>selectSelfChangeResult(db,{changesetId,conversationId:"fixture:owner",ownerId:"owner",authorityEpoch:1,nowMs:T,bind:selected.bind})}});
  expect(result).toMatchObject({execution:{kind:"selected"}});
  const cycle=db.prepare("SELECT cycle_id,occupant_id,trigger_kind FROM cycle_records").get()!;
  expect(cycle).toMatchObject({occupant_id:"owner",trigger_kind:"self_change_result"});
  expect(db.prepare("SELECT cycle_id FROM thalamus_decisions").get()!.cycle_id).toBe(cycle.cycle_id);
  expect(db.prepare("SELECT count(*) AS n FROM private_budget_reservations WHERE policy_id='ashley.self_change.v1'").get()).toEqual({n:1});
 }finally{db.close();}
});

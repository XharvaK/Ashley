import {describe,it,expect} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {createObservationSubscription,cancelObservationSubscription} from "../observation/subscriptions.js";
import {DatabaseSync} from "node:sqlite";
async function retain(db:ReturnType<typeof openTestSidecar>,items:any[]){
 const module=await import("./subscription-facts.js").catch(()=>null);
 return module?.retainSubscriptionFacts(db,{conversationId:"fixture:owner",ownerId:"owner",nowMs:1000,items}) ?? null;
}
function seed(db:ReturnType<typeof openTestSidecar>){createObservationSubscription(db,{subscriptionId:"feed",conversationId:"fixture:owner",concernId:"concern",source:"curiosity.cur_items",scope:"conversation",topicKeys:["dub techno"],match:"substring",expiresAtMs:2000,status:"active"});}
describe("durable subscription pressure",()=>{
 it("preserves a forget tombstone when the same feed item is seen again",async()=>{
  const db=openTestSidecar();try{seed(db);const items=[{itemId:"one",text:"private dub techno text",topicKey:"dub techno",createdAtMs:500}];
   await retain(db,items);db.prepare("UPDATE observations SET payload_json=?").run(JSON.stringify({redacted:true}));
   expect((await retain(db,items))?.candidates).toHaveLength(0);
   expect(JSON.parse(String(db.prepare("SELECT payload_json FROM observations").get()!.payload_json))).toEqual({redacted:true});
  }finally{db.close();}
 });
 it("delivers retained source input through the actual manager admission and dispatch path",async()=>{
  const {AgentManager}=await import("../../../agent.js");
  const prior=process.env.ASHLEY_THALAMUS_ENABLED;process.env.ASHLEY_THALAMUS_ENABLED="true";
  const db=openTestSidecar(),nuclear=new DatabaseSync(":memory:");
  try{seed(db);await retain(db,[{itemId:"one",text:"private dub techno text",topicKey:"dub techno",createdAtMs:500}]);
   nuclear.exec("CREATE TABLE mem_threads(id TEXT,owner_id TEXT,status TEXT,channel TEXT,created_at TEXT,updated_at TEXT); INSERT INTO mem_threads VALUES('fixture:owner','owner','active','discord','a','a')");
   const manager=Object.create(AgentManager.prototype) as any;manager.openCognitiveSidecar=()=>db;manager.cognitiveDeps={};manager.core={getDatabase:()=>nuclear};manager.dataPlane={};
   let calls=0;manager.dispatchCognitiveEvent=async(event:any)=>{calls++;expect(event.payload.observations).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({text:"private dub techno text"})})]));return {published:true,acceptedSettlements:1,thoughtModelAttempts:1,outboxId:null};};
   const result=await manager.tickCognitiveThalamus("owner",1000,false);
   expect(result).toMatchObject({decision:{kind:"fire",passType:"own_time"}});expect(calls).toBe(1);
   expect(db.prepare("SELECT cycle_id FROM observations").get()!.cycle_id).not.toBe("subscription:feed");
  }finally{db.close();nuclear.close();if(prior===undefined)delete process.env.ASHLEY_THALAMUS_ENABLED;else process.env.ASHLEY_THALAMUS_ENABLED=prior;}
 });
 it("a repeated item never resurrects an already admitted observation",async()=>{
  const db=openTestSidecar();try{seed(db);const items=[{itemId:"one",text:"dub techno",topicKey:"dub techno",createdAtMs:500}];
   const captured=await retain(db,items);expect(captured?.candidates).toHaveLength(1);
   const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"idle_opportunity",triggerRef:"read",nowMs:1000});
   db.prepare("UPDATE observations SET cycle_id=?,generation=?").run(cycle.cycleId,cycle.generation);
   expect((await retain(db,items))?.candidates).toHaveLength(0);
   expect(db.prepare("SELECT cycle_id FROM observations").get()!.cycle_id).toBe(cycle.cycleId);
  }finally{db.close();}
 });
 it("retains a held item and reconstructs the same pressure without reacquisition",async()=>{
  const db=openTestSidecar();try{seed(db);
   const first=await retain(db,[{itemId:"one",text:"private dub techno text",topicKey:"dub techno",createdAtMs:500}]);
   expect(first?.candidates).toHaveLength(1);const second=await retain(db,[]);
   expect(second?.candidates).toEqual(first?.candidates);
   expect(JSON.stringify(first?.candidates)).not.toContain("private dub techno text");
   expect(db.prepare("SELECT count(*) AS n FROM observations").get()!.n).toBe(1);
  }finally{db.close();}
 });
 it("rechecks cancellation before offering a retained observation",async()=>{
  const db=openTestSidecar();try{seed(db);await retain(db,[{itemId:"one",text:"dub techno",topicKey:"dub techno"}]);
   cancelObservationSubscription(db,"feed");expect((await retain(db,[]))?.candidates).toHaveLength(0);
  }finally{db.close();}
 });
});

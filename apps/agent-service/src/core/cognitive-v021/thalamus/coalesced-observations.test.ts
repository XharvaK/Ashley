import {describe,it,expect} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {appendInboxEvent} from "../cycle/inbox.js";
async function attach(db:ReturnType<typeof openTestSidecar>,input:any,extra:any[]){
 const module=await import("./execution.js");return (module as any).attachSelectedObservations?.(db,input,extra) ?? input;
}
const extra={observationId:"subscription:fixture",derived:true,replaySafe:true,modality:"subscription",payload:{text:"retained source"},provenance:"subscription:feed",dataClassification:"ordinary",secretOmitted:false};
describe("compatible observations at actual admission",()=>{
 it("binds compatible input to the actual cycle and preserves the executor payload",async()=>{
  const db=openTestSidecar();try{
   const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"idle_opportunity",triggerRef:"own-time",nowMs:1000});
   const event=appendInboxEvent(db,{id:"inner",wakeId:cycle.wakeId!,conversationId:cycle.conversationId,kind:"idle_opportunity",payload:{cycleId:cycle.cycleId,generation:cycle.generation,innerPass:{kind:"awake",slot:2}},createdAtMs:1000});
   const result=await attach(db,{cycle,event,observations:[]},[extra]);
   expect(result.observations).toMatchObject([{observationId:extra.observationId,cycleId:cycle.cycleId,generation:cycle.generation}]);
   expect(result.event.payload.innerPass).toEqual({kind:"awake",slot:2});
   expect(JSON.parse(String(db.prepare("SELECT payload_json FROM inbox_events WHERE id='inner'").get()!.payload_json)).observations).toHaveLength(1);
  }finally{db.close();}
 });
 it("rejects a mismatched event before moving any observation",async()=>{
  const db=openTestSidecar();try{
   const cycle=admitTestCycle(db,{conversationId:"fixture:owner",occupantId:"owner",triggerKind:"idle_opportunity",triggerRef:"own-time",nowMs:1000});
   await expect(attach(db,{cycle,event:{id:"wrong",conversationId:"other",payload:{cycleId:"other"}},observations:[]},[extra])).rejects.toThrow("thalamus_observation_event_identity");
   expect(db.prepare("SELECT count(*) AS n FROM observations").get()!.n).toBe(0);
  }finally{db.close();}
 });
});

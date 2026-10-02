import {describe,it,expect} from "vitest";
import {openTestSidecar} from "../test-support.js";
import {fireDueTriggers,scheduleFutureTrigger} from "../initiative/future-triggers.js";
function seed(db:ReturnType<typeof openTestSidecar>){
 db.prepare("INSERT INTO concerns(concern_id,conversation_id,statement,source_refs_json,dimensions_json,cognitive_status,snapshot_hash) VALUES('concern','fixture:owner','authored','[]','{}','resolved','snapshot')").run();
 for(const triggerId of ["selected","pending"])scheduleFutureTrigger(db,{triggerId,conversationId:"fixture:owner",concernId:"concern",snapshotHash:"snapshot",dueAtMs:100,payload:{}});
}
describe("selected idle timing preserves other obligations",()=>{
 it("does not mature an unselected due trigger",async()=>{
  const db=openTestSidecar();try{seed(db);await fireDueTriggers(db,{nowMs:100,conversationId:"fixture:owner",triggerIds:["selected"]} as any);
   expect(db.prepare("SELECT status FROM future_triggers WHERE trigger_id='pending'").get()).toMatchObject({status:"scheduled"});
   expect(db.prepare("SELECT status FROM future_triggers WHERE trigger_id='selected'").get()).toMatchObject({status:"suppressed_stale"});
  }finally{db.close();}
 });
 it("an explicitly empty selection performs no trigger maturity",async()=>{
  const db=openTestSidecar();try{seed(db);const result=await fireDueTriggers(db,{nowMs:100,triggerIds:[]} as any);
   expect(result.suppressedStale).toHaveLength(0);expect(db.prepare("SELECT count(*) AS n FROM future_triggers WHERE status='scheduled'").get()!.n).toBe(2);
  }finally{db.close();}
 });
});

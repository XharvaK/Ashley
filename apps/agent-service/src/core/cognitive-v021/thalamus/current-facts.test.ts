import {recordInterestTouches} from "../memory/interests.js";
import {recordAftermathPending} from "../thought/aftermath.js";
import {recordThalamusDecision} from "./store.js";
import {describe,it,expect} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {appendOwnerUtterance} from "../evidence/conversation-log.js";
async function collect(db:ReturnType<typeof openTestSidecar>,nowMs:number){
 const module=await import("./current-facts.js").catch(()=>null);
 return module?.collectInnerFacts(db,{ownerId:"owner",conversationId:"fixture:owner",nowMs,timeZone:"UTC",afterglowEnabled:true}) ?? null;
}
describe("current mechanical nucleus facts",()=>{
 it("keeps absent own-time history unknown and collection read-only",async()=>{
  const db=openTestSidecar();try{
   const before=db.prepare("SELECT total_changes() AS n").get()!.n;
   const result=await collect(db,1000);
   expect(result).toMatchObject({coverage:{ownTimeBaseline:"unavailable"}});
   expect(result?.candidates.some(c=>c.source==="boredom")).toBe(false);
   expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
  }finally{db.close();}
 });
 it("uses the reflection watermark and publishes no conversation text",async()=>{
  const db=openTestSidecar();try{
   for(let i=0;i<40;i++)appendOwnerUtterance(db,{conversationId:"fixture:owner",text:"private text must not appear",nowMs:100+i,audienceAtCapture:"owner_private"});
   const result=await collect(db,1000000);
   expect(result?.candidates).toEqual(expect.arrayContaining([expect.objectContaining({source:"reflective",class:"ALWAYS_THROUGH"})]));
   expect(JSON.stringify(result)).not.toContain("private text must not appear");
   db.prepare("UPDATE afterglow_state SET reflected_through_seq=100000 WHERE conversation_id=?").run("fixture:owner");
   // readAfterglowState is a pure reader; explicitly insert the watermark if it has not yet been established.
   db.prepare("INSERT OR IGNORE INTO afterglow_state(conversation_id,reflected_through_seq,updated_at_ms) VALUES(?,?,0)").run("fixture:owner",100000);
   expect((await collect(db,1000000))?.candidates.some(c=>c.source==="reflective")).toBe(false);
  }finally{db.close();}
 });
 it("includes authored interest pressure without exposing labels or notes",async()=>{
  const db=openTestSidecar();try{
   db.prepare("INSERT INTO inner_state(conversation_id,next_awake_at_ms,last_awake_at_ms,awake_slot,updated_at_ms) VALUES('fixture:owner',0,1,0,1)").run();
   db.exec("DELETE FROM interest_branches");
   const before=(await collect(db,3600001))!.candidates.find(c=>c.source==="boredom")!.salience;
   recordInterestTouches(db,[{root:"Technology",branch:"private branch",note:"private note"}],3600001);
   const result=await collect(db,3600001);
   expect(result!.candidates.find(c=>c.source==="boredom")!.salience).toBeGreaterThan(before);
   expect(JSON.stringify(result)).not.toContain("private branch");
  }finally{db.close();}
 });
 it("uses a published admitted own-time pass rather than an unexecuted timing selection",async()=>{
  const db=openTestSidecar();try{
   db.prepare("INSERT INTO inner_state(conversation_id,next_awake_at_ms,last_awake_at_ms,awake_slot,updated_at_ms) VALUES('fixture:owner',0,1,0,1)").run();
   admitTestCycle(db,{cycleId:"own",occupantId:"owner",conversationId:"fixture:owner",generation:1,triggerKind:"idle_opportunity",triggerRef:"own",nowMs:3600000});
   recordThalamusDecision(db,"receipt","owner",{kind:"fire",reason:"threshold",passType:"own_time",bundle:[],pending:[]},3600000,"own");
   expect((await collect(db,3600001))!.candidates.some(c=>c.source==="boredom")).toBe(true);
   db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES('published','own',1,'{}')").run();
   recordAftermathPending(db,{settlementId:"published",cycleId:"own",context:{conversationId:"fixture:owner",ownerPrivate:true,passKind:null,nightPass:null},nowMs:3600001});
   expect((await collect(db,3600001))!.candidates.some(c=>c.source==="boredom")).toBe(false);
  }finally{db.close();}
 });

});


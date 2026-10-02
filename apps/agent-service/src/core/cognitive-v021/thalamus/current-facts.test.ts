import {describe,it,expect} from "vitest";
import {openTestSidecar} from "../test-support.js";
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
});


// Durable attention comes from published private settlements, never from a read or a proposed effect.
import {describe,expect,it} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import type { Candidate, Decision } from "./core.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
async function api(){const module=await import(/* @vite-ignore */ "./store.js").catch(()=>null);expect(module,"attention store exists").not.toBeNull();return module!;}
const watch=(id:string)=>({id,match:{source:"external",kind:"item",object:1,predicate:"eq"},action:"wake",expires:{atMs:10000},note:"fixture private note"});
function publish(db:ReturnType<typeof openTestSidecar>,id:string,at:number,attention:unknown,overrides:Record<string,unknown>={},conversationId="fixture:owner"){
 admitTestCycle(db,{cycleId:id,conversationId,generation:1,triggerKind:"idle_opportunity",triggerRef:id,nowMs:at});
 db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES (?,?,1,?)").run(id,id,JSON.stringify({sawSecret:false,attention,...overrides}));
}
describe("T3 durable attention",()=>{
 it("records only published private untainted claims and preserves current authored state",async()=>{
  const s=await api(),db=openTestSidecar();try{
   expect(s.recordPublishedAttention(db,"absent","owner",1)).toBe("ignored");
   publish(db,"one",1,{watch:[watch("a")],resting:true,wakeWorth:"later"});
   expect(s.recordPublishedAttention(db,"one","owner",1)).toBe("recorded");
   expect(s.readAttentionWatches(db,"owner",2)).toEqual([watch("a")]);
   expect(s.readAttentionFlags(db,"owner")).toMatchObject({resting:true,wakeWorth:"later"});
   for(const [id,override,conversation] of [["secret",{sawSecret:true},"fixture:owner"],["unknown",{sawSecret:undefined},"fixture:owner"],["redacted",{redacted:true},"fixture:owner"],["public",{},"room:fixture"]] as const){
    publish(db,id,2,{watch:[watch(id)]},override,conversation);expect(s.recordPublishedAttention(db,id,"owner",2)).toBe("ignored");
   }
   expect(s.readAttentionWatches(db,"owner",2)).toEqual([watch("a")]);
  }finally{db.close();}
 });
 it("enforces sixteen live watches atomically, permits replacements and makes repeat recording idempotent",async()=>{
  const s=await api(),db=openTestSidecar();try{
   for(let n=0;n<4;n++){const id="batch"+n;publish(db,id,n+1,{watch:[0,1,2,3].map(i=>watch(String(n*4+i)))});expect(s.recordPublishedAttention(db,id,"owner",n+1)).toBe("recorded");}
   publish(db,"overflow",5,{watch:[watch("17")],resting:true});expect(s.recordPublishedAttention(db,"overflow","owner",5)).toBe("live_limit");
   expect(s.readAttentionWatches(db,"owner",5)).toHaveLength(16);expect(s.readAttentionFlags(db,"owner").resting).not.toBe(true);
   publish(db,"replace",6,{watch:[{...watch("0"),note:"replacement"}]});s.recordPublishedAttention(db,"replace","owner",6);s.recordPublishedAttention(db,"replace","owner",6);
   expect(s.readAttentionWatches(db,"owner",6)).toHaveLength(16);expect(s.readAttentionWatches(db,"owner",6).find(w=>w.id==="0")!.note).toBe("replacement");
   expect(s.readAttentionWatches(db,"other",6)).toEqual([]);
  }finally{db.close();}
 });
 it("expires time and typed-event watches without introducing a clock",async()=>{
  const s=await api(),db=openTestSidecar();try{
   publish(db,"time",1,{watch:[{...watch("time"),expires:{atMs:3}},{...watch("event"),expires:{event:{source:"social",kind:"message"}}}]});s.recordPublishedAttention(db,"time","owner",1);
   expect(s.readAttentionWatches(db,"owner",3).map(w=>w.id)).toEqual(["event"]);
   s.expireAttentionWatches(db,"owner",3,{source:"social",kind:"message"});expect(s.readAttentionWatches(db,"owner",3)).toEqual([]);
  }finally{db.close();}
 });
 it("does not let delayed older aftermath overwrite a newer watch or resting state",async()=>{
  const s=await api(),db=openTestSidecar();try{
   publish(db,"old",1,{watch:[watch("a")],resting:true});publish(db,"new",2,{watch:[{...watch("a"),note:"new"}],resting:false});
   s.recordPublishedAttention(db,"new","owner",2);s.recordPublishedAttention(db,"old","owner",3);
   expect(s.readAttentionWatches(db,"owner",3)[0].note).toBe("new");expect(s.readAttentionFlags(db,"owner").resting).toBe(false);
  }finally{db.close();}
 });
 it("retains deterministic checkpoint identity and refuses future contract or corrupt state",async()=>{
  const s=await api(),db=openTestSidecar();try{
   const state={lastNowMs:10,families:{},lastSelectedAtMs:{}};
   s.saveThalamusCheckpoint(db,"owner",state,10);expect(s.readThalamusCheckpoint(db,"owner",10)).toEqual(state);
   db.exec("UPDATE thalamus_state SET contract_version=99");expect(()=>s.readThalamusCheckpoint(db,"owner",10)).toThrow("thalamus_checkpoint_contract");
   db.prepare("UPDATE thalamus_state SET contract_version=1,state_json=?").run(JSON.stringify({lastNowMs:null}));expect(()=>s.readThalamusCheckpoint(db,"owner",10)).toThrow();
  }finally{db.close();}
 });
 it("stores only mechanical decision fields once and prunes only this Owner beyond thirty days",async()=>{
  const s=await api(),db=openTestSidecar();try{
   const candidate:Candidate={eventId:"event",observedAtMs:1,source:"external",salience:0.5,class:"PRESSURE",coalesceKey:"feed",passType:"own_time",refs:["private ref"]};
   const decision:Decision={kind:"fire",reason:"threshold",passType:"own_time",bundle:[candidate],pending:[]};
   s.recordThalamusDecision(db,"old","owner",decision,1);s.recordThalamusDecision(db,"other","other",decision,1);
   s.recordThalamusDecision(db,"new","owner",decision,P.decisionRetentionMs.default+2);s.recordThalamusDecision(db,"new","owner",decision,P.decisionRetentionMs.default+2);
   expect(db.prepare("SELECT decision_id FROM thalamus_decisions ORDER BY decision_id").all()).toEqual([{decision_id:"new"},{decision_id:"other"}]);
   expect(String(db.prepare("SELECT candidates_json FROM thalamus_decisions WHERE decision_id='new'").get()!.candidates_json)).not.toContain("private ref");
  }finally{db.close();}
 });
 it("does not discard retained history when a new decision write is rejected",async()=>{
  const s=await api(),db=openTestSidecar();try{
   const decision:Decision={kind:"none",reason:"no_candidate",pending:[]};s.recordThalamusDecision(db,"old","owner",decision,1);
   expect(()=>s.recordThalamusDecision(db,"invalid","owner",decision,P.decisionRetentionMs.default+2,"unadmitted-cycle")).toThrow();
   expect(db.prepare("SELECT decision_id FROM thalamus_decisions").all()).toEqual([{decision_id:"old"}]);
  }finally{db.close();}
 });

 it("treats an explicitly expired replacement as cancellation and frees its live slot",async()=>{
  const s=await api(),db=openTestSidecar();try{
   for(let n=0;n<4;n++){const id="batch"+n;publish(db,id,n+1,{watch:[0,1,2,3].map(i=>watch(String(n*4+i)))});s.recordPublishedAttention(db,id,"owner",n+1);}
   publish(db,"cancel-and-replace",5,{watch:[{...watch("0"),expires:{atMs:5}},watch("replacement")]});
   expect(s.recordPublishedAttention(db,"cancel-and-replace","owner",5)).toBe("recorded");
   const watches=s.readAttentionWatches(db,"owner",5);expect(watches).toHaveLength(16);expect(watches.some(w=>w.id==="0")).toBe(false);
   expect(watches.some(w=>w.id==="replacement")).toBe(true);
  }finally{db.close();}
 });

});

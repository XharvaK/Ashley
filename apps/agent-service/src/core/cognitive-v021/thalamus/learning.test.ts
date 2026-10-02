// Published admitted wake judgments learn once within the timing contract bounds.
import {arbitrate} from "./core.js";
import {recordSettlementAftermath} from "../thought/aftermath.js";
import {sensesForThought} from "../senses/senses.js";
import {thalamusStatus} from "./status.js";
import {prepareTick} from "./tick.js";
import {describe,it,expect} from "vitest";
import {openTestSidecar,admitTestCycle} from "../test-support.js";
import {recordThalamusDecision,recordPublishedAttention,readAttentionFlags,saveThalamusCheckpoint} from "./store.js";
import {recordAftermathPending} from "../thought/aftermath.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
async function api(){const m=await import("./learning.js").catch(()=>null);expect(m,"bounded wake learning must exist").not.toBeNull();return m!;}
function publish(db:ReturnType<typeof openTestSidecar>,id:string,worth:string,now:number,bind=true){
 admitTestCycle(db,{cycleId:id,conversationId:"fixture:owner",occupantId:"owner",generation:1,triggerKind:"idle_opportunity",triggerRef:id,nowMs:now});
 db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)").run(id,id,JSON.stringify({sawSecret:false,attention:{wakeWorth:worth}}));
 recordAftermathPending(db,{settlementId:id,cycleId:id,context:{conversationId:"fixture:owner",ownerPrivate:true,passKind:null,nightPass:null},nowMs:now});
 recordThalamusDecision(db,"decision:"+id,"owner",{kind:"fire",reason:"threshold",passType:"own_time",bundle:[{source:"external",eventId:id,observedAtMs:now,coalesceKey:"feed",class:"PRESSURE",salience:1,passType:"own_time",refs:[]}],pending:[]},now,bind?id:null);
}
describe("T5 published wake learning",()=>{
 it("learns only from the bound actual published wake, once across recovery",async()=>{
  const m=await api(),db=openTestSidecar();try{
   publish(db,"unbound","no",1,false);recordPublishedAttention(db,"unbound","owner",1);expect(m.readLearning(db,"owner").gains.external).toBeUndefined();
   publish(db,"bound","no",2);recordPublishedAttention(db,"bound","owner",2);
   const learned=m.readLearning(db,"owner");expect(learned.gains.external).toBeCloseTo(1+P.learningEmaAlpha.default*(P.gainNoTarget.default-1));
   expect(learned.familyGains["external:feed"]).toBeCloseTo(learned.gains.external!);
   expect(learned.habituation["external:feed"]).toBeGreaterThan(P.ambientHabituationAlpha.default);
   recordPublishedAttention(db,"bound","owner",3);expect(m.readLearning(db,"owner")).toEqual(learned);
   expect(readAttentionFlags(db,"owner").wakeWorth).toBe("no");
  }finally{db.close();}
 });
 it("keeps repeated sooner/later judgments within T0 bounds and preserves Owner isolation",async()=>{
  const m=await api(),db=openTestSidecar();try{
   for(let n=1;n<=100;n++){publish(db,"wake"+n,n<=50?"sooner":"later",n);recordPublishedAttention(db,"wake"+n,"owner",n);}
   const learned=m.readLearning(db,"owner");
   expect(learned.gains.external).toBeGreaterThanOrEqual(P.nucleusGain.learningBound.min);expect(learned.gains.external).toBeLessThanOrEqual(P.nucleusGain.learningBound.max);
   expect(learned.habituation["external:feed"]).toBeGreaterThanOrEqual(P.ambientHabituationAlpha.learningBound.min);expect(learned.habituation["external:feed"]).toBeLessThanOrEqual(P.ambientHabituationAlpha.learningBound.max);
   expect(m.readLearning(db,"other")).toEqual({gains:{},familyGains:{},habituation:{}});
  }finally{db.close();}
 });
 it("feeds the actual stored calibration into arbitration, sense and read-only Owner diagnostics",async()=>{
  const m=await api(),db=openTestSidecar();try{
   publish(db,"wake","no",1);recordPublishedAttention(db,"wake","owner",1);const learned=m.readLearning(db,"owner");
   const observation={source:"external" as const,eventId:"next",observedAtMs:2,coalesceKey:"feed",class:"PRESSURE" as const,salience:.2,passType:"own_time" as const,refs:[]};
   const result=arbitrate({lastNowMs:1,families:{"external:feed":{source:"external",response:1,arousal:0,lastObservedAtMs:1,lastEventId:"prior",lastEvaluatedAtMs:1}},lastSelectedAtMs:{}},[observation],2,{budgetAvailable:false,conversationClaimHeld:false,spentFraction:0,energy:.5,tension:0,circadianPhase:0,...learned});
   expect(result.state.families["external:feed"].response).toBeCloseTo(1-learned.habituation["external:feed"]);
   const before=db.prepare("SELECT total_changes() AS n").get()!.n;
   expect(thalamusStatus(db,"owner",2).learning).toEqual(learned);
   expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(before);
   expect(sensesForThought(db,{conversationId:"fixture:owner",ownerId:"owner",nowMs:2},[]).lines.join(" ")).toContain(JSON.stringify(learned.gains));
   prepareTick(db,{ownerId:"owner",conversationId:"fixture:other",nowMs:2,enabled:true,candidates:[],facts:[],context:{budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:.5,tension:0,circadianPhase:0}});
   const evaluation=JSON.parse(String(db.prepare("SELECT candidates_json FROM thalamus_decisions WHERE cycle_id IS NULL AND evaluated_at_ms=2").get()!.candidates_json)).evaluation;
   expect(evaluation.context.gains).toEqual(learned.gains);expect(evaluation.context.habituation).toEqual(learned.habituation);
  }finally{db.close();}
 });

 it("learns a social wake value without adopting social watches or private state",async()=>{
  const m=await api(),db=openTestSidecar();try{
   admitTestCycle(db,{cycleId:"social",conversationId:"dm:ashley:contact",generation:1,triggerKind:"external_message",triggerRef:"social",nowMs:1});
   db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES('social','social',1,?)").run(JSON.stringify({sawSecret:false,attention:{wakeWorth:"sooner"}}));
   recordAftermathPending(db,{settlementId:"social",cycleId:"social",context:{conversationId:"dm:ashley:contact",ownerPrivate:false,timingOnly:true,passKind:null,nightPass:null} as any,nowMs:1});
   db.prepare("INSERT INTO inbox_events(id,conversation_id,kind,payload_json,created_at_ms,status) VALUES('social-event','dm:ashley:contact','external_utterance',?,1,'pending')").run(JSON.stringify({ownerId:"owner",cycleId:"social"}));
   recordThalamusDecision(db,"decision:social","owner",{kind:"fire",reason:"threshold",passType:"conversation",bundle:[{source:"social",eventId:"social-event",observedAtMs:1,coalesceKey:"dm:ashley:contact",class:"PRESSURE",salience:1,passType:"conversation",refs:[]}],pending:[]},1,"social");
   saveThalamusCheckpoint(db,"owner",{lastNowMs:1,families:{},lastSelectedAtMs:{}},1);
   recordPublishedAttention(db,"social","owner",1);
   expect(m.readLearning(db,"owner").gains.social).toBeGreaterThan(1);expect(readAttentionFlags(db,"owner").wakeWorth).toBeUndefined();
   const before=m.readLearning(db,"owner");
   db.prepare("UPDATE settlements SET payload_json=? WHERE settlement_id='social'").run(JSON.stringify({sawSecret:false,attention:{wakeWorth:"sooner",resting:true},interests:[{root:"Technology",branch:"smuggled"}],journal:{entry:"smuggled",activity:"think"}}));
   expect(recordSettlementAftermath(db,"social",{identityStore:{ownerId:"owner"} as any,timeZone:"UTC",nowMs:2})).toBe("recorded");
   expect(m.readLearning(db,"owner")).toEqual(before);expect(readAttentionFlags(db,"owner").resting).toBeUndefined();
   expect(db.prepare("SELECT count(*) AS n FROM activity_journal").get()!.n).toBe(0);
   expect(db.prepare("SELECT count(*) AS n FROM interest_branches WHERE label='smuggled'").get()!.n).toBe(0);
  }finally{db.close();}
 });

});

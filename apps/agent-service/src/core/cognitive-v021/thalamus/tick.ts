import {readLearning} from "./learning.js";
// Timing proposals are durable before execution; admitted cycles alone bind causes to Thought.
import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {getCurrentCycle} from "../cycle/inbox.js";
import {isPrivateThoughtActive} from "../initiative/idle.js";
import {arbitrate,type Candidate,type Decision,type ThalamusContext} from "./core.js";
import {applyAttention,type AttentionFact} from "./attention.js";
import {expireAttentionWatches,readAttentionWatches,readThalamusCheckpoint,saveThalamusCheckpoint,recordThalamusDecision} from "./store.js";
export type TickOptions={
 ownerId:string;conversationId:string;nowMs:number;enabled:boolean;
 candidates:readonly Candidate[];facts:readonly (AttentionFact & {eventId:string})[];context:ThalamusContext;
 socialBinding?:boolean;
 execute:(decision:Extract<Decision,{kind:"fire"}>,bind:(cycleId:string)=>void)=>Promise<unknown>;
};
export function prepareTick(db:DatabaseSync,options:Omit<TickOptions,"execute">){
 if(!options.enabled)return {kind:"disabled"} as const;
 if(!options.ownerId.trim() || !options.conversationId.trim())throw new Error("thalamus_tick_identity");
 const {ownerId,conversationId,nowMs}=options;
 const decisionId=`thalamus:${randomUUID()}`;
 db.exec("SAVEPOINT thalamus_tick");
 let decision:Decision;
 try{
  expireAttentionWatches(db,ownerId,nowMs);
  for(const fact of options.facts)expireAttentionWatches(db,ownerId,nowMs,fact);
  const watches=readAttentionWatches(db,ownerId,nowMs);
  const candidates=options.candidates.map(candidate=>{
   let next=candidate;
   for(const fact of options.facts.filter(f=>f.eventId===candidate.eventId && f.source===candidate.source))next=applyAttention(next,watches,fact,nowMs);
   return next;
  });
  const context={...options.context,...readLearning(db,ownerId),conversationClaimHeld:options.context.conversationClaimHeld
   || getCurrentCycle(db,conversationId)!==null || isPrivateThoughtActive(conversationId)};
  // Mandatory work survives a conversation hold, but cannot take execution ownership.
  // Evaluate/recover observations without consuming selection/refractory state while held.
  const stateBefore=readThalamusCheckpoint(db,ownerId,nowMs);
  const evaluationContext:ThalamusContext={budgetAvailable:context.budgetAvailable && !context.conversationClaimHeld,
   conversationClaimHeld:context.conversationClaimHeld,spentFraction:context.spentFraction,energy:context.energy,
   tension:context.tension,circadianPhase:context.circadianPhase,
   ...(context.gains?{gains:context.gains}:{}),...(context.familyGains?{familyGains:context.familyGains}:{}),...(context.habituation?{habituation:context.habituation}:{})};
  const result=arbitrate(stateBefore,candidates,nowMs,evaluationContext);
  decision=context.conversationClaimHeld && context.budgetAvailable
   ? {kind:"none",reason:"conversation",pending:candidates} : result.decision;
  saveThalamusCheckpoint(db,ownerId,result.state,nowMs);
  recordThalamusDecision(db,decisionId,ownerId,decision,nowMs,null,
   {stateBefore,context:evaluationContext,conversationExecutionHeld:context.conversationClaimHeld && context.budgetAvailable,input:candidates});
  db.exec("RELEASE thalamus_tick");
 }catch(error){db.exec("ROLLBACK TO thalamus_tick; RELEASE thalamus_tick");throw error;}
 const bind=(cycleId:string)=>{
  const cycle=db.prepare("SELECT conversation_id,occupant_id,trigger_kind FROM cycle_records WHERE cycle_id=?").get(cycleId);
  const social=options.socialBinding===true && decision.kind==="fire" && decision.passType==="conversation"
   && decision.bundle.every(candidate=>candidate.source==="social");
  const identity=social ? cycle?.occupant_id===null && cycle.trigger_kind==="external_message"
   && db.prepare("SELECT id FROM inbox_events WHERE conversation_id=? AND kind='external_utterance' AND json_valid(payload_json) AND json_extract(payload_json,'$.cycleId')=? AND json_extract(payload_json,'$.ownerId')=? LIMIT 1").get(conversationId,cycleId,ownerId)
   : cycle?.occupant_id===ownerId && ["idle_opportunity","commitment_due","subscription_item","future_trigger_due"].includes(String(cycle?.trigger_kind));
  if(!cycle || cycle.conversation_id!==conversationId || !identity)throw new Error("thalamus_decision_cycle_identity");
  const changed=db.prepare("UPDATE thalamus_decisions SET cycle_id=? WHERE decision_id=? AND owner_id=? AND (cycle_id IS NULL OR cycle_id=?)").run(cycleId,decisionId,ownerId,cycleId);
  if(Number(changed.changes)!==1)throw new Error("thalamus_decision_cycle_conflict");
 };
 return {kind:"prepared",decisionId,decision,bind} as const;
}
export async function tick(db:DatabaseSync,options:TickOptions){
 const prepared=prepareTick(db,options);
 if(prepared.kind==="disabled")return prepared;
 const execution=prepared.decision.kind==="fire"?await options.execute(prepared.decision,prepared.bind):null;
 return {kind:"evaluated",decisionId:prepared.decisionId,decision:prepared.decision,execution} as const;
}

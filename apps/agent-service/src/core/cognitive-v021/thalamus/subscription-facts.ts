import type {DatabaseSync} from "node:sqlite";
import {listObservationSubscriptions,matchSubscriptionItem,type SubscriptionItem} from "../observation/subscriptions.js";
import {persistOrVerifyObservations,getCanonicalObservationById} from "../observation/persistence.js";
import {listInterestBranches} from "../memory/interests.js";
import {external} from "./nuclei/external.js";
import type {CuriosityFacts} from "../influences/curiosity.js";
import {influenceMode} from "../influences/contract-state.js";
import {readEligibility} from "../influences/eligibility.js";
import type {Candidate} from "./core.js";
import type {AttentionFact} from "./attention.js";
import type {IdleObservationDraft} from "../initiative/idle.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
/** The subscription attachment is an existing pre-cycle observation scope, not an admitted Thought. */
export function retainSubscriptionFacts(db:DatabaseSync,options:{ownerId:string;conversationId:string;nowMs:number;items:readonly SubscriptionItem[]}){
 const {ownerId,conversationId,nowMs}=options;
 const subscriptions=listObservationSubscriptions(db,conversationId);
 db.exec("SAVEPOINT thalamus_subscription_capture");
 try{
  const observations=subscriptions.flatMap(subscription=>options.items.flatMap(item=>{
   const observation=matchSubscriptionItem(subscription,item,{nowMs});if(!observation)return [];
   const existing=db.prepare("SELECT cycle_id,generation FROM observations WHERE observation_id=?").get(observation.observationId);
   if(existing && (typeof existing.cycle_id!=="string" || !existing.cycle_id.trim() || !Number.isSafeInteger(Number(existing.generation))))throw new Error("thalamus_subscription_attachment_unknown");
   const canonical=existing?getCanonicalObservationById(db,observation.observationId):null;
   const protectedObservation=(canonical?.payload as Record<string,unknown>)?.redacted===true ? {...observation,
    derived:canonical!.derived,replaySafe:canonical!.replaySafe,modality:canonical!.modality,payload:canonical!.payload,
    provenance:canonical!.provenance,dataClassification:canonical!.dataClassification,secretOmitted:canonical!.secretOmitted,
    ...(canonical!.view?{view:canonical!.view}:{}),...(canonical!.rawOutranksDerivedOf?{rawOutranksDerivedOf:canonical!.rawOutranksDerivedOf}:{})} : observation;
   // A repeated feed item must never move an already admitted observation back into the pending scope.
   return [{...protectedObservation,...(existing?{cycleId:String(existing.cycle_id),generation:Number(existing.generation)}:{})}];
  }));
  const unique=[...new Map(observations.map(observation=>[observation.observationId,observation])).values()];
  persistOrVerifyObservations(db,unique,nowMs);
  db.exec("RELEASE thalamus_subscription_capture");
 }catch(error){db.exec("ROLLBACK TO thalamus_subscription_capture; RELEASE thalamus_subscription_capture");throw error;}
 const branches=listInterestBranches(db,nowMs);
 const mode=influenceMode(db);
 const eligible=new Set(db.prepare("SELECT id,branch_key FROM learned_influences WHERE owner_id=? AND branch_key IS NOT NULL AND adjudication_state='accepted' AND qualified_at<?").all(ownerId,new Date(nowMs).toISOString())
  .filter(row=>readEligibility(db,Number(row.id),{mode,at:new Date(nowMs)})).map(row=>String(row.branch_key)));
 const candidates:Candidate[]=[],facts:(AttentionFact & {eventId:string})[]=[],curiosity:CuriosityFacts[]=[];
 const retained=new Map<string,IdleObservationDraft>();
 for(const subscription of subscriptions){
  for(const row of db.prepare("SELECT observation_id,created_at_ms FROM observations WHERE cycle_id=? AND modality='subscription' AND secret_omitted=0 AND data_classification!='secret' ORDER BY created_at_ms,observation_id").all(`subscription:${subscription.subscriptionId}`)){
   const canonical=getCanonicalObservationById(db,String(row.observation_id));if(!canonical)continue;
   const payload=canonical.payload as Record<string,unknown>;
   if(!payload)continue;
   if(payload.kind==="operational_watch_outcome"){
    candidates.push({eventId:canonical.observationId,observedAtMs:Number(row.created_at_ms),refs:[canonical.observationId],
     source:"external",class:"OPPORTUNISTIC",salience:P.theta0.default,coalesceKey:subscription.subscriptionId,passType:"own_time"});
    facts.push({eventId:canonical.observationId,source:"external",kind:"operational_outcome",subject:subscription.subscriptionId,
     ...(typeof payload.outcome==="string"?{object:payload.outcome}:{})});
    retained.set(canonical.observationId,{observationId:canonical.observationId,derived:canonical.derived,replaySafe:canonical.replaySafe,
     modality:canonical.modality,payload:canonical.payload,provenance:canonical.provenance,dataClassification:canonical.dataClassification,secretOmitted:canonical.secretOmitted});
    continue;
   }
   const item:SubscriptionItem={text:typeof payload.text==="string"?payload.text:undefined,topicKey:typeof payload.topicKey==="string"?payload.topicKey:undefined,
    source:typeof payload.source==="string"?payload.source:undefined,dataClassification:canonical.dataClassification,payload:payload.payload};
   if(!matchSubscriptionItem(subscription,item,{nowMs}))continue;
   // Equality over a typed topic identifier; never classify or infer topics from message text.
   const branch=branches.find(branch=>item.topicKey===branch.branchId || item.topicKey===branch.label || item.topicKey===branch.root);
   const fact:CuriosityFacts={eventId:canonical.observationId,observedAtMs:Number(row.created_at_ms),refs:[canonical.observationId],
    subscriptionId:subscription.subscriptionId,subscriptionCurrent:true,novelty:1,interestMatch:branch?Math.min(1,branch.strength):0,branchKey:branch?.branchId ?? null};
   const candidate=external({...fact,influenceEligible:fact.branchKey!==null && eligible.has(fact.branchKey)},mode);
   if(!candidate)continue;
   candidates.push(candidate);curiosity.push(fact);
   facts.push({eventId:candidate.eventId,source:"external",kind:"item",subject:subscription.subscriptionId,
    ...(typeof payload.itemId==="string"?{object:payload.itemId}:{}),...(item.topicKey?{topics:[item.topicKey]}:{})});
   retained.set(candidate.eventId,{observationId:canonical.observationId,derived:canonical.derived,replaySafe:canonical.replaySafe,
    modality:canonical.modality,payload:canonical.payload,provenance:canonical.provenance,dataClassification:canonical.dataClassification,
    secretOmitted:canonical.secretOmitted,...(canonical.rawOutranksDerivedOf?{rawOutranksDerivedOf:canonical.rawOutranksDerivedOf}:{})});
  }
 }
 return {candidates,facts,curiosity,retained};
}

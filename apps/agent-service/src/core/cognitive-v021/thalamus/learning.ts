// Published judgments calibrate timing sensitivity; they never grant authority or change theta0.
import type {DatabaseSync} from "node:sqlite";
import type {Candidate,Nucleus} from "./core.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
export type LearningState={gains:Partial<Record<Nucleus,number>>;familyGains:Record<string,number>;habituation:Record<string,number>};
const empty=():LearningState=>({gains:{},familyGains:{},habituation:{}});
const clamp=(v:number,b:{min:number;max:number})=>Math.max(b.min,Math.min(b.max,v));
export function readLearning(db:DatabaseSync,ownerId:string):LearningState{
 const row=db.prepare("SELECT attention_json,contract_version FROM thalamus_state WHERE owner_id=?").get(ownerId);
 if(!row)return empty();if(Number(row.contract_version)!==P.parameterContractVersion.default)throw new Error("thalamus_learning_contract");
 const value=JSON.parse(String(row.attention_json)).learning ?? empty();
 for(const key of ["gains","familyGains","habituation"] as const){
  if(!value[key] || typeof value[key]!=="object" || Array.isArray(value[key]))throw new Error("thalamus_learning_corrupt");
  for(const [name,number] of Object.entries(value[key])){
   const bounds=key==="gains"?P.nucleusGain.learningBound:key==="familyGains"?P.familyGain.learningBound:
    name.startsWith("social:")?P.socialHabituationAlpha.learningBound:P.ambientHabituationAlpha.learningBound;
   if(typeof number!=="number" || !Number.isFinite(number) || number<bounds.min || number>bounds.max)throw new Error("thalamus_learning_corrupt");
  }
 }
 return value;
}
/** Called within attention publication's transaction, after its private/untainted claim checks. */
export function learnPublishedWake(db:DatabaseSync,settlementId:string,ownerId:string,worth:"yes"|"no"|"sooner"|"later",nowMs:number):boolean{
 if(!["yes","no","sooner","later"].includes(worth))return false;
 const row=db.prepare(`SELECT d.decision_id,d.candidates_json,d.pass_type,a.context_json,s.payload_json,c.occupant_id,c.trigger_kind,c.conversation_id,c.cycle_id FROM settlements s
  JOIN cycle_records c ON c.cycle_id=s.cycle_id JOIN settlement_aftermath a ON a.settlement_id=s.settlement_id
  JOIN thalamus_decisions d ON d.cycle_id=c.cycle_id AND d.owner_id=? AND d.decision_code='fire'
  WHERE s.settlement_id=? AND (c.occupant_id=? OR c.occupant_id IS NULL) AND a.created_at_ms<=? ORDER BY d.evaluated_at_ms DESC,d.decision_id DESC LIMIT 1`).get(ownerId,settlementId,ownerId,nowMs);
 if(!row)return false;
 const context=JSON.parse(String(row.context_json)),payload=JSON.parse(String(row.payload_json)),receipt=JSON.parse(String(row.candidates_json));
 if(payload.redacted===true || payload.sawSecret!==false || payload.attention?.wakeWorth!==worth || receipt.learningSettlementId)return false;
 const privateWake=context.ownerPrivate===true && row.occupant_id===ownerId;
 const socialWake=context.ownerPrivate===false && context.timingOnly===true && row.occupant_id===null && row.trigger_kind==="external_message"
  && row.pass_type==="conversation" && receipt.bundle.length>0 && receipt.bundle.every((candidate:Candidate)=>candidate.source==="social")
  && Object.keys(payload.attention).every(key=>key==="wakeWorth")
  && db.prepare("SELECT id FROM inbox_events WHERE conversation_id=? AND kind='external_utterance' AND json_valid(payload_json) AND json_extract(payload_json,'$.cycleId')=? AND json_extract(payload_json,'$.ownerId')=? LIMIT 1").get(row.conversation_id,row.cycle_id,ownerId);
 if(!privateWake && !socialWake)return false;
 const learned=readLearning(db,ownerId),target={yes:P.gainYesTarget.default,no:P.gainNoTarget.default,sooner:P.gainSoonerTarget.default,later:P.gainLaterTarget.default}[worth];
 const ema=(current:number,next:number,bounds:{min:number;max:number})=>clamp(current+P.learningEmaAlpha.default*(next-current),bounds);
 const sources=new Set<Nucleus>(),families=new Set<string>();
 for(const candidate of receipt.bundle as Candidate[]){
  if(!["reflective","sleep","prospective","external","boredom","interoceptive","social"].includes(candidate.source) || !candidate.coalesceKey)throw new Error("thalamus_learning_receipt");
  const family=`${candidate.source}:${candidate.coalesceKey}`;
  if(!sources.has(candidate.source)){learned.gains[candidate.source]=ema(learned.gains[candidate.source] ?? P.nucleusGain.default,target,P.nucleusGain.learningBound);sources.add(candidate.source);}
  if(families.has(family))continue;families.add(family);
  learned.familyGains[family]=ema(learned.familyGains[family] ?? P.familyGain.default,target,P.familyGain.learningBound);
  if(candidate.class!=="ALWAYS_THROUGH"){
   const parameter=candidate.source==="social"?P.socialHabituationAlpha:P.ambientHabituationAlpha;
   learned.habituation[family]=ema(learned.habituation[family] ?? parameter.default,
    worth==="no" || worth==="later"?parameter.learningBound.max:parameter.learningBound.min,parameter.learningBound);
  }
 }
 const state=db.prepare("SELECT attention_json FROM thalamus_state WHERE owner_id=?").get(ownerId);
 if(!state)throw new Error("thalamus_learning_state_missing");
 const flags=JSON.parse(String(state.attention_json));flags.learning=learned;
 db.prepare("UPDATE thalamus_state SET attention_json=? WHERE owner_id=?").run(JSON.stringify(flags),ownerId);
 receipt.learningSettlementId=settlementId;receipt.learningWorth=worth;
 db.prepare("UPDATE thalamus_decisions SET candidates_json=? WHERE decision_id=? AND owner_id=?").run(JSON.stringify(receipt),row.decision_id,ownerId);
 return true;
}

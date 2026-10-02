import {readLearning} from "./learning.js";
import type {DatabaseSync} from "node:sqlite";
import {schedulerContract} from "./scheduler.js";
import {readAttentionWatches} from "./store.js";
/** Owner-scoped evidence projection. Never opens, migrates, expires or repairs a store. */
export function thalamusStatus(db:DatabaseSync|null,ownerId:string,nowMs:number) {
 const contract=schedulerContract();
 const unavailable={...contract,availability:"unavailable" as const,watchCount:null,lastDecision:null,learning:null};
 if(!db || !ownerId.trim())return unavailable;
 try{
  const watchCount=readAttentionWatches(db,ownerId,nowMs).length;
  const row=db.prepare(`SELECT evaluated_at_ms,decision_code,reason_code,pass_type FROM thalamus_decisions
   WHERE owner_id=? ORDER BY evaluated_at_ms DESC,decision_id DESC LIMIT 1`).get(ownerId);
  return {...contract,availability:"available" as const,watchCount,learning:readLearning(db,ownerId),lastDecision:row ? {
   atMs:Number(row.evaluated_at_ms),code:String(row.decision_code),reason:String(row.reason_code),
   passType:row.pass_type==null?null:String(row.pass_type),
  }:null};
 }catch{return unavailable;}
}

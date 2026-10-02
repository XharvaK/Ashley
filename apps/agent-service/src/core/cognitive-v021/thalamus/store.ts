// Publication owns attention claims; this store keeps bounded private intent and mechanical timing receipts.
import type { DatabaseSync } from "node:sqlite";
import { isOwnerPrivateConversation } from "../memory/semantic-forget.js";
import { arbitrate, type Decision, type ThalamusState, type Candidate } from "./core.js";
import { isValidAttentionClaim, watchExpired, type AttentionWatch, type AttentionFact } from "./attention.js";
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
type Row = Record<string,unknown>;
export type AttentionFlags = { resting?: boolean; wakeWorth?: "yes"|"no"|"sooner"|"later"; lastClaimAtMs?: number; lastSettlementId?: string };
const empty = ():ThalamusState => ({lastNowMs:0,families:{},lastSelectedAtMs:{}});
function time(nowMs:number):void { if (!Number.isSafeInteger(nowMs) || nowMs<0) throw new Error("attention_invalid_time"); }
function stateRow(db:DatabaseSync,ownerId:string):Row|undefined {
  const row=db.prepare("SELECT * FROM thalamus_state WHERE owner_id=?").get(ownerId);
  if(row && Number(row.contract_version)!==P.parameterContractVersion.default)throw new Error("thalamus_checkpoint_contract");
  return row;
}
export function readAttentionFlags(db:DatabaseSync,ownerId:string):AttentionFlags {
  const row=stateRow(db,ownerId);return row ? JSON.parse(String(row.attention_json)) as AttentionFlags : {};
}
export function readAttentionWatches(db:DatabaseSync,ownerId:string,nowMs:number):AttentionWatch[] {
  time(nowMs);
  return db.prepare("SELECT * FROM attention_watches WHERE owner_id=? ORDER BY created_at_ms,watch_id").all(ownerId)
    .map(row=>({id:String(row.watch_id),match:JSON.parse(String(row.match_json)),action:row.action,
      expires:JSON.parse(String(row.expires_json)),note:String(row.note)} as AttentionWatch))
    .filter(watch=>!watchExpired(watch,nowMs));
}
export function expireAttentionWatches(db:DatabaseSync,ownerId:string,nowMs:number,fact?:AttentionFact):void {
  time(nowMs);
  for(const row of db.prepare("SELECT watch_id,expires_json FROM attention_watches WHERE owner_id=?").all(ownerId)){
    const watch={expires:JSON.parse(String(row.expires_json))} as AttentionWatch;
    if(watchExpired(watch,nowMs,fact))db.prepare("DELETE FROM attention_watches WHERE owner_id=? AND watch_id=?").run(ownerId,String(row.watch_id));
  }
}
/** Used only after publication; delayed recovery keeps the original published/admitted timestamp. */
export function recordPublishedAttention(db:DatabaseSync,settlementId:string,ownerId:string,nowMs:number):"recorded"|"ignored"|"live_limit" {
  time(nowMs);if(!ownerId.trim())return "ignored";
  const row=db.prepare(`SELECT s.payload_json,s.cycle_id,c.conversation_id,c.admitted_at_ms,a.created_at_ms,a.context_json
    FROM settlements s JOIN cycle_records c ON c.cycle_id=s.cycle_id
    LEFT JOIN settlement_aftermath a ON a.settlement_id=s.settlement_id WHERE s.settlement_id=?`).get(settlementId);
  if(!row)return "ignored";
  const publicationContext=row.context_json == null ? null : JSON.parse(String(row.context_json)) as Row;
  const ownerPrivate=publicationContext?.ownerPrivate ?? isOwnerPrivateConversation(String(row.conversation_id));
  if(ownerPrivate!==true)return "ignored";
  const payload=JSON.parse(String(row.payload_json)) as Row;
  if(payload.redacted===true || payload.sawSecret!==false || !isValidAttentionClaim(payload.attention))return "ignored";
  const atMs=Number(row.created_at_ms ?? row.admitted_at_ms);time(atMs);
  if(atMs>nowMs)return "ignored";
  const claim=payload.attention,flags=readAttentionFlags(db,ownerId);
  if(atMs<Number(flags.lastClaimAtMs ?? -1))return "ignored";
  db.exec("SAVEPOINT attention_claim");
  try{
    expireAttentionWatches(db,ownerId,nowMs);
    const live=new Set(readAttentionWatches(db,ownerId,nowMs).map(watch=>watch.id));
    for(const watch of claim.watch ?? []) {
      if(watchExpired(watch,nowMs))live.delete(watch.id);
      else live.add(watch.id);
    }
    if(live.size>P.watchLive.default){db.exec("ROLLBACK TO attention_claim; RELEASE attention_claim");return "live_limit";}
    for(const watch of claim.watch ?? []){
      if(watchExpired(watch,nowMs)) {
        db.prepare("DELETE FROM attention_watches WHERE owner_id=? AND watch_id=? AND created_at_ms<=?").run(ownerId,watch.id,atMs);
        continue;
      }
      db.prepare(`INSERT INTO attention_watches(owner_id,watch_id,cycle_id,match_json,action,expires_json,note,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,watch_id) DO UPDATE SET cycle_id=excluded.cycle_id,
        match_json=excluded.match_json,action=excluded.action,expires_json=excluded.expires_json,note=excluded.note,
        created_at_ms=excluded.created_at_ms WHERE excluded.created_at_ms>=attention_watches.created_at_ms`)
        .run(ownerId,watch.id,String(row.cycle_id),JSON.stringify(watch.match),watch.action,JSON.stringify(watch.expires),watch.note,atMs);
    }
    if(atMs>=Number(flags.lastClaimAtMs ?? -1)){
      const next={...flags,...(claim.resting===undefined?{}:{resting:claim.resting}),
        ...(claim.wakeWorth===undefined?{}:{wakeWorth:claim.wakeWorth}),lastClaimAtMs:atMs,lastSettlementId:settlementId};
      db.prepare(`INSERT INTO thalamus_state(owner_id,contract_version,state_json,attention_json,updated_at_ms)
        VALUES(?,?,?, ?,?) ON CONFLICT(owner_id) DO UPDATE SET attention_json=excluded.attention_json,
        updated_at_ms=MAX(thalamus_state.updated_at_ms,excluded.updated_at_ms)`)
        .run(ownerId,P.parameterContractVersion.default,JSON.stringify(empty()),JSON.stringify(next),nowMs);
    }
    db.exec("RELEASE attention_claim");return "recorded";
  }catch(error){db.exec("ROLLBACK TO attention_claim; RELEASE attention_claim");throw error;}
}
function validateCheckpoint(state:ThalamusState):void {
  arbitrate(state,[],state.lastNowMs,{budgetAvailable:false,conversationClaimHeld:false,spentFraction:0,energy:0.5,tension:0,circadianPhase:0});
  for(const value of Object.values(state.lastSelectedAtMs))if(!Number.isFinite(value) || Number(value)>state.lastNowMs)throw new Error("thalamus_invalid_checkpoint");
}
export function readThalamusCheckpoint(db:DatabaseSync,ownerId:string,nowMs:number):ThalamusState {
  time(nowMs);const row=stateRow(db,ownerId);if(!row)return empty();
  const state=JSON.parse(String(row.state_json)) as ThalamusState;validateCheckpoint(state);return state;
}
export function saveThalamusCheckpoint(db:DatabaseSync,ownerId:string,state:ThalamusState,nowMs:number):void {
  time(nowMs);if(!ownerId.trim() || state.lastNowMs>nowMs)throw new Error("thalamus_invalid_checkpoint");
  stateRow(db,ownerId);validateCheckpoint(state);
  db.prepare(`INSERT INTO thalamus_state(owner_id,contract_version,state_json,attention_json,updated_at_ms)
    VALUES(?,?,?,'{}',?) ON CONFLICT(owner_id) DO UPDATE SET state_json=excluded.state_json,
    updated_at_ms=excluded.updated_at_ms WHERE excluded.updated_at_ms>=thalamus_state.updated_at_ms`)
    .run(ownerId,P.parameterContractVersion.default,JSON.stringify(state),nowMs);
}
function mechanical(candidate:Candidate):Record<string,unknown>{
  return {eventId:candidate.eventId,observedAtMs:candidate.observedAtMs,source:candidate.source,salience:candidate.salience,
    class:candidate.class,coalesceKey:candidate.coalesceKey,passType:candidate.passType,
    ...(candidate.deadlineMs===undefined?{}:{deadlineMs:candidate.deadlineMs})};
}
/** Timing receipt only: fire is a proposed pass, never execution, delivery or promotion. */
export function recordThalamusDecision(db:DatabaseSync,decisionId:string,ownerId:string,decision:Decision,nowMs:number,cycleId:string|null=null):void {
  time(nowMs);if(!ownerId.trim() || !decisionId.trim())throw new Error("thalamus_invalid_decision_identity");
  db.exec("SAVEPOINT thalamus_decision");
  try {
    db.prepare("DELETE FROM thalamus_decisions WHERE owner_id=? AND evaluated_at_ms<=?").run(ownerId,nowMs-P.decisionRetentionMs.default);
    const candidates={bundle:decision.kind==="fire"?decision.bundle.map(mechanical):[],pending:decision.pending.map(mechanical)};
    db.prepare(`INSERT INTO thalamus_decisions(decision_id,owner_id,cycle_id,evaluated_at_ms,decision_code,reason_code,pass_type,candidates_json)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(decision_id) DO NOTHING`).run(decisionId,ownerId,cycleId,nowMs,decision.kind,decision.reason,decision.kind==="fire"?decision.passType:null,JSON.stringify(candidates));
    db.exec("RELEASE thalamus_decision");
  } catch(error) {
    db.exec("ROLLBACK TO thalamus_decision; RELEASE thalamus_decision");throw error;
  }
}

/** Only the decision bound to this admitted cycle describes why this Thought woke. */
export function readThoughtAttention(db:DatabaseSync,ownerId:string,cycleId:string,nowMs:number):import("./attention.js").ThoughtAttention {
  const row=db.prepare("SELECT candidates_json FROM thalamus_decisions WHERE owner_id=? AND cycle_id=? AND decision_code='fire' ORDER BY evaluated_at_ms DESC,decision_id DESC LIMIT 1").get(ownerId,cycleId);
  const bundle:Candidate[]=row ? (JSON.parse(String(row.candidates_json)).bundle as Candidate[]).map(candidate=>({...candidate,refs:[]})) : [];
  return {watching:readAttentionWatches(db,ownerId,nowMs),wokeBecause:bundle.slice(0,1),alsoOnYourMind:bundle.slice(1)};
}

/** Exact phrase erasure is the Owner's existing forget mechanism, not watch interpretation. */
export function attentionWatchIdsForForget(db:DatabaseSync,topic:string):string[]{
  const needle=topic.toLocaleLowerCase();
  return db.prepare("SELECT owner_id,watch_id,note,match_json,expires_json FROM attention_watches").all()
    .filter(row=>[row.note,row.match_json,row.expires_json].some(value=>String(value).toLocaleLowerCase().includes(needle)))
    .map(row=>JSON.stringify([String(row.owner_id),String(row.watch_id)]));
}
export function forgetAttentionWatch(db:DatabaseSync,key:string):number {
  const [ownerId,watchId]=JSON.parse(key) as string[];
  return Number(db.prepare("DELETE FROM attention_watches WHERE owner_id=? AND watch_id=?").run(ownerId,watchId).changes);
}
/** Detach derived attention when its published semantic source is erased. */
export function forgetSettlementAttention(db:DatabaseSync,settlementId:string):number {
  let changes=Number(db.prepare("UPDATE settlements SET payload_json=json_remove(payload_json,'$.attention') WHERE settlement_id=? AND json_type(payload_json,'$.attention') IS NOT NULL").run(settlementId).changes);
  changes+=Number(db.prepare("DELETE FROM attention_watches WHERE cycle_id IN (SELECT cycle_id FROM settlements WHERE settlement_id=?)").run(settlementId).changes);
  for(const row of db.prepare("SELECT owner_id,attention_json FROM thalamus_state").all()){
    const flags=JSON.parse(String(row.attention_json)) as AttentionFlags;
    if(flags.lastSettlementId!==settlementId)continue;
    changes+=Number(db.prepare("UPDATE thalamus_state SET attention_json=? WHERE owner_id=?").run(JSON.stringify({lastClaimAtMs:flags.lastClaimAtMs,lastSettlementId:settlementId}),String(row.owner_id)).changes);
  }
  return changes;
}

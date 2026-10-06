import {listInterestBranches} from "../memory/interests.js";
import type {DatabaseSync} from "node:sqlite";
import {readAfterglowState} from "../initiative/afterglow.js";
import {domusSessionsDue} from "../../domus/session.js";
import {readInnerState} from "../initiative/awake.js";
import {readNightState,quietestHour} from "../initiative/night.js";
import {readMood} from "../growth/mood.js";
import {readSenseFacts} from "../senses/senses.js";
import {getPrivateBudgetProjection,PRIVATE_THOUGHT_POLICY_ID} from "../private-budget/ledger.js";
import {readAttentionFlags,readThalamusCheckpoint} from "./store.js";
import {reflective, sessionReflective} from "./nuclei/reflective.js";
import {sleep} from "./nuclei/sleep.js";
import {boredom} from "./nuclei/boredom.js";
import {interoceptive} from "./nuclei/interoceptive.js";
import {prospective} from "./nuclei/prospective.js";
import type {Candidate,ThalamusContext} from "./core.js";
import type {AttentionFact} from "./attention.js";
import {THALAMUS_PARAMETERS as P} from "./parameters.js";
type Options={ownerId:string;conversationId:string;nowMs:number;timeZone:string;afterglowEnabled:boolean;dataDir?:string};
/** Read metadata from its current owners. No text matching, acquisition, admission or clock writes. */
export function collectInnerFacts(db:DatabaseSync,options:Options){
 const {ownerId,conversationId,nowMs}=options;
 const count=(sql:string,...args:(string|number)[])=>Number(db.prepare(sql).get(...args)!.n);
 const candidates:Candidate[]=[];const facts:(AttentionFact & {eventId:string})[]=[];
 const push=(candidate:Candidate|null)=>{if(candidate)candidates.push(candidate);};
 const mood=readMood(db,nowMs),flags=readAttentionFlags(db,ownerId);
 const state=readThalamusCheckpoint(db,ownerId,nowMs);
 const watermark=readAfterglowState(db,conversationId).reflectedThroughSeq;
 const rows=db.prepare(`SELECT rowid AS seq,row_id,created_at_ms FROM conversation_evidence_log
  WHERE conversation_id=? AND rowid>? AND role IN ('owner','ashley') AND text IS NOT NULL AND text!=''
  AND source_status!='redacted' AND (role='owner' OR delivered=1) ORDER BY rowid`).all(conversationId,watermark);
 const lastMessage=db.prepare("SELECT MAX(created_at_ms) AS at FROM conversation_evidence_log WHERE conversation_id=? AND role IN ('owner','ashley')").get(conversationId);
 const lastAt=Number(lastMessage?.at ?? 0);
 const appraisal=db.prepare(`SELECT valence_delta,energy_delta,openness_delta,tension_delta FROM mood_events
  WHERE forgotten_at_ms IS NULL AND data_classification!='secret' AND created_at_ms<=? ORDER BY created_at_ms DESC,event_id DESC LIMIT 1`).get(nowMs);
 const magnitude=appraisal ? Math.max(...Object.values(appraisal).map(value=>Math.abs(Number(value)))) : 0;
 if(options.afterglowEnabled && rows.length)push(reflective({eventId:`reflection:${conversationId}:${rows.at(-1)!.seq}`,observedAtMs:lastAt,
  refs:rows.map(row=>String(row.row_id)),unreflectedRows:rows.length,lastMessageAtMs:lastAt,appraisalMagnitude:magnitude},nowMs));
 // M2: a stretch of play that is over (or long) is due as it stands; the afterglow executor reflects it.
 if(options.afterglowEnabled)for(const session of domusSessionsDue(db,nowMs).slice(0,1))push(sessionReflective({
  eventId:`reflection:domus:${session.world}:${session.throughMs}`,observedAtMs:session.lastAtMs,refs:session.observationIds.slice(-8)},nowMs));
 const night=readNightState(db,conversationId),since=night?.lastNightAtMs ?? 0;
 const quietHour=night?.quietHour ?? quietestHour(db,{nowMs,timeZone:options.timeZone});
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:options.timeZone,hour:"numeric",hourCycle:"h23"}).formatToParts(nowMs);
 const localHour=Number(parts.find(part=>part.type==="hour")!.value);
 const work={
  episodes:count("SELECT count(*) AS n FROM episodes_v2 WHERE conversation_id=? AND forgotten_at_ms IS NULL AND data_classification!='secret' AND created_at_ms>? AND created_at_ms<=?",conversationId,since,nowMs),
  memories:count("SELECT count(*) AS n FROM memory_strength s JOIN sidecar_memory_assertions a ON a.assertion_key=s.assertion_key WHERE a.live=1 AND a.data_classification!='secret' AND s.formed_at_ms>? AND s.formed_at_ms<=?",since,nowMs),
  rows:count("SELECT count(*) AS n FROM conversation_evidence_log WHERE conversation_id=? AND role IN ('owner','ashley') AND source_status!='redacted' AND (role='owner' OR delivered=1) AND created_at_ms>? AND created_at_ms<=?",conversationId,since,nowMs),
  openRevisions:count("SELECT count(*) AS n FROM growth_revisions WHERE status IN ('proposed','ripe') AND forgotten_at_ms IS NULL AND data_classification!='secret' AND updated_at_ms>? AND updated_at_ms<=?",since,nowMs),
  expectations:count("SELECT count(*) AS n FROM expectations WHERE status='open' AND forgotten_at_ms IS NULL AND data_classification!='secret' AND created_at_ms>? AND created_at_ms<=?",since,nowMs),
 };
 push(sleep({eventId:`sleep:${conversationId}:${since}:${Object.values(work).join(':')}`,observedAtMs:nowMs,refs:[],...work,quietHour,currentLocalHour:localHour}));
 const inner=readInnerState(db,conversationId);
 const ownPublication=db.prepare(`SELECT MAX(a.created_at_ms) AS at FROM thalamus_decisions d
  JOIN cycle_records c ON c.cycle_id=d.cycle_id JOIN settlements s ON s.cycle_id=c.cycle_id
  JOIN settlement_aftermath a ON a.settlement_id=s.settlement_id
  WHERE d.owner_id=? AND d.decision_code='fire' AND d.pass_type='own_time' AND c.conversation_id=?
  AND c.occupant_id=? AND a.created_at_ms<=?`).get(ownerId,conversationId,ownerId,nowMs);
 const baselines=[inner?.lastAwakeAtMs,ownPublication?.at].filter((value):value is number=>typeof value==="number" && Number.isFinite(value) && value<=nowMs);
 const idleSinceMs=baselines.length?Math.max(...baselines):null;
 const agenda=count("SELECT count(*) AS n FROM mind_occupancy WHERE conversation_id=? AND status!='resolved'",conversationId);
 push(boredom({eventId:`boredom:${conversationId}:${idleSinceMs}`,observedAtMs:nowMs,refs:[],idleSinceMs,energy:mood.energy,openness:mood.openness,agendaPressure:Math.min(1,agenda+Math.max(0,...listInterestBranches(db,nowMs).map(branch=>branch.strength))),resting:flags.resting===true},nowMs));
 for(const reading of readSenseFacts(db,{nowMs,conversationId,dataDir:options.dataDir})){
  const eventId=`sense:${reading.sense}:${reading.band}`;
  const family=state.families[`interoceptive:sense:${reading.sense}`];
  const prefix=`sense:${reading.sense}:`;
  const previousBand=family?.lastEventId.startsWith(prefix)?family.lastEventId.slice(prefix.length):null;
  const decline=db.prepare("SELECT declined_band,until_ms,reraised_at_ms FROM sense_declines WHERE sense=? AND data_classification!='secret'").get(reading.sense);
  candidates.push(...interoceptive([{eventId,observedAtMs:nowMs,refs:[],sense:reading.sense,band:reading.band,previousBand,
   ...(decline?{declinedBand:String(decline.declined_band),declineUntilMs:Number(decline.until_ms),declineReraised:decline.reraised_at_ms!==null}:{})}],nowMs));
  facts.push({eventId,source:"interoceptive",kind:"band",subject:reading.sense,object:reading.band,...(previousBand===null?{}:{previousObject:previousBand})});
 }
 const triggers=db.prepare("SELECT trigger_id,due_at_ms FROM future_triggers WHERE conversation_id=? AND status IN ('scheduled','needs_review') AND due_at_ms<=? ORDER BY due_at_ms,trigger_id").all(conversationId,nowMs);
 candidates.push(...prospective(triggers.map(row=>({eventId:`trigger:${row.trigger_id}`,observedAtMs:Number(row.due_at_ms),refs:[String(row.trigger_id)],kind:"trigger" as const,dueAtMs:Number(row.due_at_ms)})),nowMs));
 const budget=getPrivateBudgetProjection(db,{policyId:PRIVATE_THOUGHT_POLICY_ID,wallClockNowMs:nowMs});
 const context:ThalamusContext={budgetAvailable:budget.remaining>0 && budget.clockState!=="clock_reconciliation",conversationClaimHeld:false,
  spentFraction:budget.limit>0?budget.consumingCount/budget.limit:1,energy:mood.energy,tension:mood.tension,
  circadianPhase:Math.cos(2*Math.PI*(localHour-quietHour)/P.hoursPerDay.default)};
 // Polling pressure is not a new observation. Preserve identity/time until the fact changes.
 for(const candidate of candidates){
  const family=state.families[`${candidate.source}:${candidate.coalesceKey}`];
  if(family?.lastEventId===candidate.eventId)candidate.observedAtMs=family.lastObservedAtMs;
 }
 return {candidates,facts,context,coverage:{ownTimeBaseline:idleSinceMs===null?"unavailable":"available"}};
}



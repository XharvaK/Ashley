// Offline only. Read retained timing/codes; never migrate, acquire traffic, or infer missing historical decisions.
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const hash=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
const exists=(db,table)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const passKinds=new Set(["afterglow","night","awake"]);
export async function replay(sidecarPath,journalPath){
 const path=resolve(sidecarPath);const before=hash(path);
 const journal=JSON.parse(readFileSync(journalPath,"utf8"));
 if(!Array.isArray(journal) || journal.some(row=>!Number.isSafeInteger(row.atMs) || !passKinds.has(row.passType)
  || !["ran","scheduled","abandoned"].includes(row.outcome)))throw new Error("replay_invalid_timing_journal");
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec("PRAGMA query_only=ON");
  if(db.prepare("PRAGMA quick_check").get().quick_check!=="ok")throw new Error("replay_source_integrity");
  const schema=Number(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id=1").get().schema_version);
  const rows=db.prepare(`SELECT c.cycle_id,c.trigger_kind,c.state,c.admitted_at_ms,
   (SELECT json_extract(i.payload_json,'$.innerPass.kind') FROM inbox_events i
    WHERE i.wake_id=c.wake_id AND json_extract(i.payload_json,'$.innerPass.kind') IN ('afterglow','night','awake')
    ORDER BY i.created_at_ms DESC LIMIT 1) AS pass_kind
   FROM cycle_records c ORDER BY c.admitted_at_ms,c.cycle_id`).all();
  const timeline=rows.map(row=>({cycleId:String(row.cycle_id),atMs:Number(row.admitted_at_ms),triggerKind:String(row.trigger_kind),
   state:String(row.state),passType:passKinds.has(row.pass_kind)?row.pass_kind:null}));
  const exact={available:0,replayed:0,mismatches:[],missingEvaluation:0};
  if(exists(db,"thalamus_decisions")){
   const decisions=db.prepare("SELECT decision_id,evaluated_at_ms,decision_code,reason_code,pass_type,candidates_json FROM thalamus_decisions ORDER BY evaluated_at_ms,decision_id").all();
   exact.available=decisions.length;
   const {arbitrate}=await import(new URL("../../apps/agent-service/dist/core/cognitive-v021/thalamus/core.js",import.meta.url));
   for(const row of decisions){
    const retained=JSON.parse(String(row.candidates_json));const evaluation=retained.evaluation;
    if(!evaluation?.stateBefore || !evaluation?.context || !Array.isArray(evaluation.input)){exact.missingEvaluation++;continue;}
    const candidates=evaluation.input.map(candidate=>({...candidate,refs:[]}));
    const result=arbitrate(evaluation.stateBefore,candidates,Number(row.evaluated_at_ms),evaluation.context);
    const decision=evaluation.conversationExecutionHeld
     ? {kind:"none",reason:"conversation",pending:candidates}:result.decision;
    const ids=values=>values.map(value=>value.eventId);
    const actual={kind:decision.kind,reason:decision.reason,passType:decision.kind==="fire"?decision.passType:null,
     bundle:ids(decision.kind==="fire"?decision.bundle:[]),pending:ids(decision.pending)};
    const expected={kind:row.decision_code,reason:row.reason_code,passType:row.pass_type,bundle:ids(retained.bundle),pending:ids(retained.pending)};
    exact.replayed++;
    if(JSON.stringify(actual)!==JSON.stringify(expected))exact.mismatches.push(String(row.decision_id));
   }
  }
  const counts={};for(const row of timeline)counts[row.passType ?? row.triggerKind]=(counts[row.passType ?? row.triggerKind] ?? 0)+1;
  return {kind:"partial_historical_replay",source:{sha256:before,schema,readOnly:true},retainedAdmissions:timeline.length,counts,
   journalTimingRecords:journal.length,journalCounts:journal.reduce((counts,row)=>{const key=`${row.passType}:${row.outcome}`;counts[key]=(counts[key] ?? 0)+1;return counts;},{}),timeline,
   exactDecisionReplay:exact,
   coverage:{retainedAdmissionOrder:"AVAILABLE",retainedPassCodes:"AVAILABLE",historicalHolds:"UNAVAILABLE",
    overwrittenClockStates:"UNAVAILABLE",historicalCandidateSalience:"UNAVAILABLE",historicalBudgetAndMoodAtHold:"UNAVAILABLE",
    counterfactualWakeCounts:"NOT_RECONSTRUCTIBLE_FROM_ADMISSIONS_ALONE",thresholdCalibration:"PROVISIONAL_NOT_ESTABLISHED"},
   invariants:{historicalOwnerAdmissionCompleteness:"UNKNOWN",historicalAfterglowWindowCoverage:"UNKNOWN",historicalCommitmentDueCompleteness:"UNKNOWN"}};
 }finally{
  db.close();if(hash(path)!==before)throw new Error("replay_source_changed");
 }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);const options={};
  for(let i=0;i<args.length;i+=2){if(!["--sidecar","--journal"].includes(args[i]) || !args[i+1] || options[args[i]])throw new Error("usage: replay.mjs --sidecar OWNER_COPY --journal TIMING_JOURNAL_JSON");options[args[i]]=args[i+1];}
  if(!options["--sidecar"] || !options["--journal"])throw new Error("replay_inputs_required");
  const report=await replay(options["--sidecar"],options["--journal"]);process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(report.exactDecisionReplay.mismatches.length)process.exitCode=1;
 }catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
}

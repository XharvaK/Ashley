import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"ashley-t4-replay-fixture-"));const path=join(dir,"sidecar-copy.db");const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE cognitive_sidecar_meta(id INTEGER,schema_version INTEGER);INSERT INTO cognitive_sidecar_meta VALUES(1,54);
 CREATE TABLE cycle_records(cycle_id TEXT,wake_id TEXT,trigger_kind TEXT,state TEXT,admitted_at_ms INTEGER);
 CREATE TABLE inbox_events(wake_id TEXT,payload_json TEXT,created_at_ms INTEGER);
 INSERT INTO cycle_records VALUES('late','wake-late','idle_opportunity','idle',200),('owner','wake-owner','owner_message','idle',100);
 INSERT INTO inbox_events VALUES('wake-late','{"innerPass":{"kind":"awake"},"private":"must-not-be-exported"}',200);`);
 db.close();const journal=join(dir,"journal-timing.json");writeFileSync(journal,JSON.stringify([{atMs:201,passType:"awake",outcome:"ran",codes:{slot:"1"}}]));
 return {path,journal};
}
function run(f){return spawnSync(process.execPath,[fileURLToPath(new URL("./replay.mjs",import.meta.url)),"--sidecar",f.path,"--journal",f.journal],{encoding:"utf8"});}
test("partial replay orders retained admissions and states historical coverage gaps",()=>{
 const f=fixture();const result=run(f);assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
 assert.equal(report.kind,"partial_historical_replay");assert.equal(report.retainedAdmissions,2);
 assert.deepEqual(report.timeline.map(row=>row.cycleId),["owner","late"]);
 assert.equal(report.timeline[1].passType,"awake");assert.equal(report.journalTimingRecords,1);
 assert.equal(report.exactDecisionReplay.available,0);assert.equal(report.coverage.historicalHolds,"UNAVAILABLE");
 assert.equal(report.invariants.historicalOwnerAdmissionCompleteness,"UNKNOWN");
 assert.equal(result.stdout.includes("must-not-be-exported"),false);
});
test("replay opens only a read-only copy and leaves its bytes unchanged",()=>{
 const f=fixture();const digest=()=>createHash("sha256").update(readFileSync(f.path)).digest("hex");const before=digest();
 const result=run(f);assert.equal(result.status,0,result.stderr);assert.equal(digest(),before);
 assert.equal(JSON.parse(result.stdout).source.sha256,before);
});
test("replays retained mechanical decisions and reports code drift",()=>{
 const f=fixture();const db=new DatabaseSync(f.path);
 db.exec("CREATE TABLE thalamus_decisions(decision_id TEXT,evaluated_at_ms INTEGER,decision_code TEXT,reason_code TEXT,pass_type TEXT,candidates_json TEXT)");
 const candidate={eventId:"deadline",observedAtMs:200,source:"prospective",salience:0,class:"ALWAYS_THROUGH",coalesceKey:"deadline",passType:"own_time",suppressed:false};
 const evaluation={stateBefore:{lastNowMs:0,families:{},lastSelectedAtMs:{}},context:{budgetAvailable:true,conversationClaimHeld:false,spentFraction:0,energy:0.5,tension:0,circadianPhase:0},conversationExecutionHeld:false,input:[candidate]};
 db.prepare("INSERT INTO thalamus_decisions VALUES ('decision',200,'fire','mandatory','own_time',?)").run(JSON.stringify({bundle:[candidate],pending:[],evaluation}));db.close();
 let result=run(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).exactDecisionReplay,{available:1,replayed:1,mismatches:[],missingEvaluation:0});
 const changed=new DatabaseSync(f.path);changed.exec("UPDATE thalamus_decisions SET reason_code='threshold'");changed.close();
 result=run(f);assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout).exactDecisionReplay.mismatches,["decision"]);
});

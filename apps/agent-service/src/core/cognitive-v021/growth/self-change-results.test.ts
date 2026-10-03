import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureSelfChangeBudget } from "./self-change.js";
import { createHmac, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
const results = await import("./self-change-results.js").catch(() => ({})) as typeof import("./self-change-results.js");
const secret = "fixture-only-authentication-key-32bytes";
const result = { version: 1 as const, changesetId: "cs_fixture", proposalCommit: "a".repeat(40), manifestSha256: "b".repeat(64), outcome: "rejected" as const, decidedAtMs: 10, decisionRef: "owner:fixture", summary: "Authored review result" };
function envelope(value: unknown = result) { const payload = JSON.stringify(value); return JSON.stringify({ payload, hmacSha256: createHmac("sha256", secret).update(payload).digest("hex") }); }
function api() { expect(typeof results.authenticateSelfChangeResult).toBe("function"); return results; }
describe("authenticated self-change results", () => {
 it("authenticates bounded exact bytes and refuses tampering", () => {
  const port = api(); expect(port.authenticateSelfChangeResult(envelope(), secret)).toMatchObject(result);
  expect(() => port.authenticateSelfChangeResult(envelope().replace("rejected", "accepted"), secret)).toThrow("self_change_result_authentication_failed");
 });
 it("refuses absent credentials and malformed result authority", () => {
  const port = api(); expect(() => port.authenticateSelfChangeResult(envelope(), "")).toThrow("self_change_result_authentication_unconfigured");
  expect(() => port.authenticateSelfChangeResult(envelope({ ...result, changesetId: "../outside" }), secret)).toThrow("self_change_result_invalid");
 });
 it("retains one durable private inbox receipt after retry and refuses conflicting decisions", () => {
  const port = api(); const db = openTestSidecar();
  try {
   const value = port.authenticateSelfChangeResult(envelope(), secret);
   const first = port.admitSelfChangeResult(db, { result: value, conversationId: "private-self", nowMs: 11 });
   const second = port.admitSelfChangeResult(db, { result: value, conversationId: "private-self", nowMs: 12 });
   expect(first.kind).toBe("admitted"); expect(second.kind).toBe("existing"); expect(first.event.id).toBe(second.event.id);
   expect(db.prepare("SELECT count(*) AS n FROM inbox_events WHERE kind='self_change_result'").get()).toEqual({ n: 1 });
   expect(() => port.admitSelfChangeResult(db, { result: { ...value, summary: "different" }, conversationId: "private-self", nowMs: 13 })).toThrow("self_change_result_conflict");
  } finally { db.close(); }
 });
});

describe("self-change result file poller", () => {
 async function fixture(test: (db: ReturnType<typeof openTestSidecar>, directory: string) => Promise<void>) {
  const db = openTestSidecar(); const directory = await mkdtemp(join(tmpdir(), "ashley-result-fixture-"));
  try { await test(db, directory); } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
 }
 function pollApi() { expect(typeof results.pollSelfChangeResults).toBe("function"); return results.pollSelfChangeResults; }
 it("disabled polling does not read artifacts or admit work", async () => {
  const poll = pollApi(); const db = openTestSidecar();
  try { expect(await poll(db, { enabled: false, directory: "missing", key: "", conversationId: "", nowMs: 11 })).toMatchObject({ status: "disabled", admitted: 0 }); }
  finally { db.close(); }
 });
 it("stages authenticated receipts without waking or spending before timing selection", async () => {
  const poll = pollApi(); await fixture(async (db, directory) => {
   configureSelfChangeBudget(db, { limit: 3, version: 1 });
   await writeFile(join(directory, "cs_fixture.result.json"), envelope());
   const input = { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 11 };
   expect(await poll(db, input)).toMatchObject({ status: "polled", admitted: 1, refused: 0 });
   expect(await poll(db, { ...input, nowMs: 12 })).toMatchObject({ admitted: 0, existing: 1 });
   expect(db.prepare("SELECT count(*) AS n FROM inbox_events").get()).toEqual({ n: 0 });
   expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({ n: 0 });
   expect(db.prepare("SELECT count(*) AS n FROM private_budget_reservations").get()).toEqual({ n: 0 });
  });
 });
 it("refuses unconfigured policy before creating an inbox receipt", async () => {
  const poll = pollApi(); await fixture(async (db, directory) => {
   await writeFile(join(directory, "cs_fixture.result.json"), envelope());
   expect(await poll(db, { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 11 })).toMatchObject({ status: "unconfigured", admitted: 0 });
   expect(db.prepare("SELECT count(*) AS n FROM inbox_events").get()).toEqual({ n: 0 });
  });
 });
 it("rejects invalid authentication and filename binding without admitting work", async () => {
  const poll = pollApi(); await fixture(async (db, directory) => {
   configureSelfChangeBudget(db, { limit: 3, version: 1 });
   await writeFile(join(directory, "cs_tampered.result.json"), envelope().replace("rejected", "accepted"));
   await writeFile(join(directory, "cs_other.result.json"), envelope());
   expect(await poll(db, { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 11 })).toMatchObject({ admitted: 0, refused: 2 });
   expect(db.prepare("SELECT count(*) AS n FROM inbox_events").get()).toEqual({ n: 0 });
  });
 });
});

it("recovers a receipt persisted before reservation without creating another wake", async () => {
 const db = openTestSidecar(); const directory = await mkdtemp(join(tmpdir(), "ashley-result-recovery-"));
 try {
  configureSelfChangeBudget(db, { limit: 3, version: 1 });
  const value = results.authenticateSelfChangeResult(envelope(), secret);
  const first = results.admitSelfChangeResult(db, { result: value, conversationId: "private-self", nowMs: 11 });
  db.prepare("INSERT INTO self_change_result_receipts (changeset_id,conversation_id,result_digest,result_json,received_at_ms,event_id,admitted_at_ms) VALUES (?,?,?,?,?,?,?)")
   .run(value.changesetId,"private-self",createHash("sha256").update(JSON.stringify(value)).digest("hex"),JSON.stringify(value),11,first.event.id,11);
  await writeFile(join(directory, "cs_fixture.result.json"), envelope());
  expect(await results.pollSelfChangeResults(db, { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 12 })).toMatchObject({ admitted: 0, existing: 1 });
  expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({ n: 1 });
  expect(typeof results.selectSelfChangeResult).toBe("function");
  results.selectSelfChangeResult(db, { changesetId: result.changesetId, conversationId: "private-self", ownerId: "owner", authorityEpoch: 1, nowMs: 12, bind: () => {} });
  expect(db.prepare("SELECT wake_id FROM private_budget_reservations").get()).toEqual({ wake_id: first.event.wakeId });
 } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

it("reconstructs the original authenticated result for recovery", () => {
 const db = openTestSidecar();
 try {
  const first = results.admitSelfChangeResult(db, { result, conversationId: "private-self", nowMs: 11 });
  const cycleId = (first.event.payload as { cycleId: string }).cycleId;
  expect(results.selfChangeResultForThought(db, { id: "recovery-event", conversationId: "private-self" }, cycleId)).toEqual(result);
 } finally { db.close(); }
});
it("reads the durable receipt rather than a forged caller payload", () => {
 const db = openTestSidecar();
 try {
  const first = results.admitSelfChangeResult(db, { result, conversationId: "private-self", nowMs: 11 });
  const forged = { ...first.event, payload: { selfChangeResult: { ...result, summary: "forged" } } };
  expect(results.selfChangeResultForThought(db, forged)).toEqual(result);
 } finally { db.close(); }
});

it("maintenance is inert without activation and closes its producer before shutdown", async () => {
 expect(typeof results.createSelfChangeResultMaintenance).toBe("function");
 const db = openTestSidecar();
 try {
  const maintenance = results.createSelfChangeResultMaintenance(db, { directory: "missing", conversationId: () => null, config: () => ({ enabled: false, key: "" }) });
  expect(await maintenance.poll(11)).toMatchObject({ status: "disabled" });
  await maintenance.close(); expect(await maintenance.poll(12)).toMatchObject({ status: "closed" });
 } finally { db.close(); }
});
it("maintenance admits only into the actual configured private conversation", async () => {
 expect(typeof results.createSelfChangeResultMaintenance).toBe("function");
 const db = openTestSidecar(); const directory = await mkdtemp(join(tmpdir(), "ashley-result-maintenance-"));
 const maintenance = results.createSelfChangeResultMaintenance(db, { directory, conversationId: () => "private-self", config: () => ({ enabled: true, key: secret }) });
 try {
  configureSelfChangeBudget(db, { limit: 3, version: 1 }); await writeFile(join(directory, "cs_fixture.result.json"), envelope());
  expect(await maintenance.poll(11)).toMatchObject({ admitted: 1 });
  expect(db.prepare("SELECT conversation_id FROM self_change_result_receipts").get()).toEqual({ conversation_id: "private-self" });
  expect(db.prepare("SELECT count(*) AS n FROM inbox_events").get()).toEqual({ n: 0 });
 } finally { await maintenance.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
});

it("creates the private cycle and reservation only when timing selects the staged receipt", async () => {
 expect(typeof results.selectSelfChangeResult).toBe("function");
 const db=openTestSidecar(); const directory=await mkdtemp(join(tmpdir(),"ashley-result-selected-"));
 try {
  configureSelfChangeBudget(db,{limit:3,version:1}); await writeFile(join(directory,"cs_fixture.result.json"),envelope());
  await results.pollSelfChangeResults(db,{enabled:true,directory,key:secret,conversationId:"private-self",nowMs:11});
  const bound:string[]=[];
  const selected=results.selectSelfChangeResult(db,{changesetId:result.changesetId,conversationId:"private-self",ownerId:"owner",authorityEpoch:1,nowMs:12,bind:id=>bound.push(id)});
  expect(selected.kind).toBe("selected"); expect(bound).toHaveLength(1);
  expect(db.prepare("SELECT occupant_id,trigger_kind FROM cycle_records").get()).toEqual({occupant_id:"owner",trigger_kind:"self_change_result"});
  expect(db.prepare("SELECT count(*) AS n FROM private_budget_reservations").get()).toEqual({n:1});
  expect(db.prepare("SELECT event_id FROM self_change_result_receipts").get()!.event_id).toBe("self-change-result:cs_fixture");
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

it("rolls back a failed timing binding and keeps the observation pending",async()=>{
 const db=openTestSidecar();const directory=await mkdtemp(join(tmpdir(),"ashley-result-rollback-"));
 try{
  configureSelfChangeBudget(db,{limit:3,version:1});await writeFile(join(directory,"cs_fixture.json"),envelope());
  await results.pollSelfChangeResults(db,{enabled:true,directory,key:secret,conversationId:"private-self",nowMs:11});
  expect(()=>results.selectSelfChangeResult(db,{changesetId:result.changesetId,conversationId:"private-self",ownerId:"owner",authorityEpoch:1,nowMs:12,bind:()=>{throw new Error("bind_failed");}})).toThrow("bind_failed");
  expect(db.prepare("SELECT count(*) AS n FROM inbox_events").get()).toEqual({n:0});
  expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({n:0});
  expect(results.pendingSelfChangeResults(db,"private-self",12)).toEqual([{changesetId:result.changesetId,receivedAtMs:11}]);
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
it("refuses a future-dated signed decision before durable staging",async()=>{
 const db=openTestSidecar();const directory=await mkdtemp(join(tmpdir(),"ashley-result-future-"));
 try{
  configureSelfChangeBudget(db,{limit:3,version:1});await writeFile(join(directory,"cs_fixture.json"),envelope());
  expect(await results.pollSelfChangeResults(db,{enabled:true,directory,key:secret,conversationId:"private-self",nowMs:9})).toMatchObject({refused:1,admitted:0});
  expect(results.pendingSelfChangeResults(db,"private-self",12)).toEqual([]);
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

it("drops once for an authenticated explicit BLOCKING finding while generic blocked is distinct",async()=>{
 const db=openTestSidecar();const directory=await mkdtemp(join(tmpdir(),"ashley-result-ladder-"));
 try{
  const {readSelfChangeLadder}=await import("./self-change-ladder.js");
  configureSelfChangeBudget(db,{limit:3,version:1});
  await writeFile(join(directory,"cs_generic.json"),envelope({...result,changesetId:"cs_generic",outcome:"blocked"}));
  const input={enabled:true,directory,key:secret,conversationId:"private-self",nowMs:11};
  await results.pollSelfChangeResults(db,input);expect(readSelfChangeLadder(db).level).toBe(1);
  await writeFile(join(directory,"cs_finding.json"),envelope({...result,changesetId:"cs_finding",reviewDisposition:"BLOCKING"}));
  expect(await results.pollSelfChangeResults(db,input)).toMatchObject({refused:0});
  expect(readSelfChangeLadder(db)).toMatchObject({level:0,revision:1});
  await results.pollSelfChangeResults(db,input);expect(readSelfChangeLadder(db).revision).toBe(1);
  expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({n:0});
 }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

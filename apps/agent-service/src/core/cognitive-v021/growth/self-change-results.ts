import {recordSelfChangeLadderFinding} from "./self-change-ladder.js";
// Authenticate operator observations; admission never grants acceptance, merge, or deployment authority.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants, type Dir } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveBudgetPolicy } from "../private-budget/policies.js";
import { getPrivateReservationForWake, getPrivateBudgetProjection, reservePrivateThought } from "../private-budget/ledger.js";
import { SELF_CHANGE_POLICY_ID, SELF_CHANGE_WINDOW_MS } from "./self-change.js";
import type { DatabaseSync } from "node:sqlite";
import { appendInboxEvent, appendInboxEventInTransaction, getInboxEvent, getCycle } from "../cycle/inbox.js";

export type SelfChangeResult = { version: 1; changesetId: string; proposalCommit: string; manifestSha256: string;
  outcome: "rejected" | "accepted" | "blocked" | "reverted"; decidedAtMs: number; decisionRef: string; summary: string; reviewDisposition?: "BLOCKING" | "NONBLOCKING" | "NOTE" };
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digest = /^[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function validate(value: unknown): SelfChangeResult {
  if (!record(value) || value.version !== 1 || typeof value.changesetId !== "string" || !/^cs_[A-Za-z0-9_-]{1,160}$/.test(value.changesetId)
    || typeof value.proposalCommit !== "string" || !oid.test(value.proposalCommit)
    || typeof value.manifestSha256 !== "string" || !digest.test(value.manifestSha256)
    || !["rejected", "accepted", "blocked", "reverted"].includes(String(value.outcome))
    || !Number.isSafeInteger(value.decidedAtMs) || Number(value.decidedAtMs) < 0
    || typeof value.decisionRef !== "string" || !value.decisionRef.trim() || value.decisionRef.length > 200
    || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 4000
    || (value.reviewDisposition !== undefined && !["BLOCKING","NONBLOCKING","NOTE"].includes(String(value.reviewDisposition)))
    || Object.keys(value).some(key => !["version","changesetId","proposalCommit","manifestSha256","outcome","decidedAtMs","decisionRef","summary","reviewDisposition"].includes(key))) {
    throw new Error("self_change_result_invalid");
  }
  return { version: 1, changesetId: value.changesetId, proposalCommit: value.proposalCommit, manifestSha256: value.manifestSha256,
    outcome: value.outcome as SelfChangeResult["outcome"], decidedAtMs: Number(value.decidedAtMs), decisionRef: value.decisionRef, summary: value.summary,
    ...(value.reviewDisposition === undefined ? {} : {reviewDisposition: value.reviewDisposition as SelfChangeResult["reviewDisposition"]}) };
}
export function authenticateSelfChangeResult(raw: string, key: string): SelfChangeResult {
  if (Buffer.byteLength(key) < 32) throw new Error("self_change_result_authentication_unconfigured");
  if (Buffer.byteLength(raw) > 32 * 1024) throw new Error("self_change_result_invalid");
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { throw new Error("self_change_result_invalid"); }
  if (!record(envelope) || typeof envelope.payload !== "string" || typeof envelope.hmacSha256 !== "string" || !digest.test(envelope.hmacSha256)
    || Object.keys(envelope).some(key => key !== "payload" && key !== "hmacSha256")) throw new Error("self_change_result_invalid");
  const expected = createHmac("sha256", key).update(envelope.payload, "utf8").digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.hmacSha256, "hex"))) throw new Error("self_change_result_authentication_failed");
  try { return validate(JSON.parse(envelope.payload)); } catch { throw new Error("self_change_result_invalid"); }
}
export function admitSelfChangeResult(db: DatabaseSync, input: { result: SelfChangeResult; conversationId: string; nowMs: number }) {
  const result = validate(input.result);
  if (!input.conversationId.trim() || !Number.isSafeInteger(input.nowMs) || input.nowMs < result.decidedAtMs) throw new Error("self_change_result_context_invalid");
  const id = "self-change-result:" + result.changesetId;
  const resultDigest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  const existing = getInboxEvent(db, id);
  if (existing) {
    const payload = existing.payload as Record<string, unknown>;
    if (existing.kind !== "self_change_result" || existing.conversationId !== input.conversationId || payload.resultDigest !== resultDigest) throw new Error("self_change_result_conflict");
    return { kind: "existing" as const, event: existing };
  }
  // appendInboxEvent owns the atomic wake/cycle/event transaction. The event is the durable per-changeset receipt.
  const event = appendInboxEvent(db, { id, conversationId: input.conversationId, kind: "self_change_result",
    payload: { selfChangeResult: result, resultDigest }, createdAtMs: input.nowMs });
  return { kind: "admitted" as const, event };
}

export type SelfChangeResultPollState = { directory?: string; handle?: Dir };
/** Local authenticated operator feed. File polling never creates credentials or chooses a policy limit. */
export async function pollSelfChangeResults(db: DatabaseSync, input: {
 enabled: boolean; directory: string; key: string; conversationId: string; nowMs: number; state?: SelfChangeResultPollState;
}) {
 const counts = { admitted: 0, existing: 0, refused: 0, budgetDeferred: 0 };
 if (!input.enabled) return { status: "disabled" as const, ...counts };
 if (Buffer.byteLength(input.key) < 32 || !input.conversationId.trim()) return { status: "unconfigured" as const, ...counts };
 try { if (resolveBudgetPolicy(db, SELF_CHANGE_POLICY_ID).windowMs !== SELF_CHANGE_WINDOW_MS) return { status: "unconfigured" as const, ...counts }; }
 catch { return { status: "unconfigured" as const, ...counts }; }
 const directory = resolve(input.directory);
 let directoryStat: Awaited<ReturnType<typeof lstat>>;
 try {
  directoryStat = await lstat(directory);
 } catch (error) {
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return { status: "unconfigured" as const, ...counts };
  throw error;
 }
 if (directory !== input.directory || directoryStat.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("self_change_result_directory_invalid");
 const state = input.state ?? {};
 if (state.directory && state.directory !== directory) throw new Error("self_change_result_directory_changed");
 state.directory = directory;
 state.handle ??= await opendir(directory);
 try {
  // Keep an open directory cursor across maintenance passes; retained receipts cannot starve later files.
  for (let scanned = 0; scanned < 32; scanned++) {
   const entry = await state.handle.read();
   if (!entry) { await state.handle.close(); state.handle = undefined; break; }
   if (!/^cs_[A-Za-z0-9_-]{1,160}(?:\.result)?\.json$/.test(entry.name)) continue;
   try {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("self_change_result_path_invalid");
    const path = join(directory, entry.name);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 32 * 1024) throw new Error("self_change_result_path_invalid");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let raw: string;
    try {
     const stat = await handle.stat();
     if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > 32 * 1024) throw new Error("self_change_result_path_invalid");
     const bytes = Buffer.alloc(32 * 1024 + 1); const read = await handle.read(bytes, 0, bytes.length, 0);
     if (read.bytesRead > 32 * 1024) throw new Error("self_change_result_invalid");
     raw = bytes.subarray(0, read.bytesRead).toString("utf8");
    } finally { await handle.close(); }
    const result = authenticateSelfChangeResult(raw, input.key);
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < result.decidedAtMs) throw new Error("self_change_result_context_invalid");
    if (entry.name !== result.changesetId + ".json" && entry.name !== result.changesetId + ".result.json") throw new Error("self_change_result_filename_mismatch");
    const resultDigest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    db.exec("SAVEPOINT self_change_result_stage");
    let previous: Record<string,unknown> | undefined;
    try {
     previous = db.prepare("SELECT conversation_id,result_digest,event_id FROM self_change_result_receipts WHERE changeset_id=?").get(result.changesetId);
     if (previous && (previous.conversation_id !== input.conversationId || previous.result_digest !== resultDigest)) throw new Error("self_change_result_conflict");
     if (!previous) db.prepare("INSERT INTO self_change_result_receipts (changeset_id,conversation_id,result_digest,result_json,received_at_ms) VALUES (?,?,?,?,?)")
      .run(result.changesetId,input.conversationId,resultDigest,JSON.stringify(result),input.nowMs);
     if(result.outcome==="reverted")recordSelfChangeLadderFinding(db,{eventId:result.changesetId+":revert",kind:"revert",reference:result.changesetId,nowMs:input.nowMs});
     else if(result.reviewDisposition==="BLOCKING")recordSelfChangeLadderFinding(db,{eventId:result.changesetId+":BLOCKING",kind:"BLOCKING",reference:result.changesetId,nowMs:input.nowMs});
     db.exec("RELEASE self_change_result_stage");
    }catch(error){db.exec("ROLLBACK TO self_change_result_stage; RELEASE self_change_result_stage");throw error;}
    if(previous?.event_id) {
     const event=getInboxEvent(db,String(previous.event_id));
     if(!event?.wakeId)throw new Error("self_change_result_receipt_missing");
     const bound=getPrivateReservationForWake(db,event.wakeId);
     if(bound && bound.policyId!==SELF_CHANGE_POLICY_ID)throw new Error("self_change_result_policy_conflict");
     if(!bound) {
      const repaired=reservePrivateThought(db,{admissionId:event.id,wakeId:event.wakeId,conversationId:input.conversationId,policyId:SELF_CHANGE_POLICY_ID,wallClockNowMs:input.nowMs});
      if(repaired.kind!=="reserved" && repaired.kind!=="existing")counts.budgetDeferred++;
      else db.prepare("UPDATE inbox_events SET next_eligible_at_ms=NULL WHERE id=? AND state='pending'").run(event.id);
     } else db.prepare("UPDATE inbox_events SET next_eligible_at_ms=NULL WHERE id=? AND state='pending'").run(event.id);
    }
    counts[previous ? "existing" : "admitted"]++;
   } catch { counts.refused++; } // Never log signed result text, keys, or filesystem/transport details.
  }
 } finally {
  if (!input.state && state.handle) { await state.handle.close(); state.handle = undefined; }
 }
 return { status: "polled" as const, ...counts };
}

/** Re-read the bound durable receipt; never project caller-supplied unsigned result payloads. */
export function selfChangeResultForThought(db: DatabaseSync, event: { id: string; conversationId: string }, originCycleId?: string): SelfChangeResult {
 const origin = originCycleId ? getCycle(db, originCycleId) : null;
 if (originCycleId && (!origin || origin.triggerKind !== "self_change_result" || origin.conversationId !== event.conversationId)) throw new Error("self_change_result_origin_invalid");
 const persisted = getInboxEvent(db, origin?.triggerRef ?? event.id);
 if (!persisted || persisted.kind !== "self_change_result" || persisted.conversationId !== event.conversationId) throw new Error("self_change_result_receipt_missing");
 const payload = persisted.payload as Record<string, unknown>;
 const result = validate(payload.selfChangeResult);
 if (payload.resultDigest !== createHash("sha256").update(JSON.stringify(result)).digest("hex")) throw new Error("self_change_result_conflict");
 return result;
}

export function createSelfChangeResultMaintenance(db: DatabaseSync, input: {
 directory: string; conversationId: () => string | null; config: () => { enabled: boolean; key: string };
}) {
 const state: SelfChangeResultPollState = {};
 let closed = false;
 let running: Promise<Awaited<ReturnType<typeof pollSelfChangeResults>>> | null = null;
 const poll = async (nowMs: number) => {
  if (closed) return { status: "closed" as const };
  if (running) return { status: "busy" as const };
  const config = input.config();
  if (!config.enabled) return { status: "disabled" as const };
  const conversationId = input.conversationId();
  if (!conversationId || conversationId.startsWith("room:")) return { status: "unconfigured" as const };
  running = pollSelfChangeResults(db, { ...config, directory: input.directory, conversationId, nowMs, state });
  try { return await running; } finally { running = null; }
 };
 return { poll, close: async () => {
  closed = true;
  try { await running; } finally { if (state.handle) { await state.handle.close(); state.handle = undefined; } }
 } };
}
export type SelfChangeResultMaintenance = ReturnType<typeof createSelfChangeResultMaintenance>;

/** Pending operator observations have no cycle until the prospective timing pass selects one. */
export function pendingSelfChangeResults(db: DatabaseSync, conversationId: string, nowMs: number) {
 return db.prepare("SELECT changeset_id,received_at_ms FROM self_change_result_receipts WHERE conversation_id=? AND event_id IS NULL AND received_at_ms<=? ORDER BY received_at_ms,changeset_id LIMIT 32")
  .all(conversationId,nowMs).map(row=>({changesetId:String(row.changeset_id),receivedAtMs:Number(row.received_at_ms)}));
}
export function selfChangeResultBudgetAvailable(db: DatabaseSync, nowMs: number): boolean {
 try {
  if(resolveBudgetPolicy(db,SELF_CHANGE_POLICY_ID).windowMs!==SELF_CHANGE_WINDOW_MS)return false;
  const budget=getPrivateBudgetProjection(db,{policyId:SELF_CHANGE_POLICY_ID,wallClockNowMs:nowMs});
  return budget.remaining>0 && budget.clockState!=="clock_reconciliation";
 }catch{return false;}
}
/** The selected cycle and timing receipt are committed together; budget repair never creates another wake. */
export function selectSelfChangeResult(db: DatabaseSync,input:{changesetId:string;conversationId:string;ownerId:string;authorityEpoch:number;nowMs:number;bind:(cycleId:string)=>void}) {
 const row=db.prepare("SELECT * FROM self_change_result_receipts WHERE changeset_id=? AND conversation_id=?").get(input.changesetId,input.conversationId);
 if(!row || Number(row.received_at_ms)>input.nowMs)throw new Error("self_change_result_receipt_missing");
 const result=validate(JSON.parse(String(row.result_json)));
 if(createHash("sha256").update(JSON.stringify(result)).digest("hex")!==row.result_digest)throw new Error("self_change_result_conflict");
 const id="self-change-result:"+result.changesetId;
 if(row.event_id)return {kind:"existing" as const,event:getInboxEvent(db,String(row.event_id))!};
 if(!selfChangeResultBudgetAvailable(db,input.nowMs))return {kind:"deferred" as const};
 db.exec("BEGIN IMMEDIATE");
 let event:ReturnType<typeof appendInboxEvent>;
 try {
  event=appendInboxEventInTransaction(db,{id,conversationId:input.conversationId,kind:"self_change_result",
   payload:{selfChangeResult:result,resultDigest:row.result_digest,occupantId:input.ownerId,authorityEpoch:input.authorityEpoch},createdAtMs:input.nowMs},id);
  db.prepare("UPDATE inbox_events SET next_eligible_at_ms=? WHERE id=? AND state='pending'").run(Number.MAX_SAFE_INTEGER,id);
  const cycleId=String((event.payload as Record<string,unknown>).cycleId);
  input.bind(cycleId);
  db.prepare("UPDATE self_change_result_receipts SET event_id=?,admitted_at_ms=? WHERE changeset_id=? AND event_id IS NULL").run(id,input.nowMs,result.changesetId);
  db.exec("COMMIT");
 }catch(error){db.exec("ROLLBACK");throw error;}
 const reservation=getPrivateReservationForWake(db,event.wakeId!) ?? reservePrivateThought(db,{admissionId:id,wakeId:event.wakeId!,conversationId:input.conversationId,policyId:SELF_CHANGE_POLICY_ID,wallClockNowMs:input.nowMs});
 if("reservation" in reservation || "reservationId" in reservation)db.prepare("UPDATE inbox_events SET next_eligible_at_ms=NULL WHERE id=? AND state='pending'").run(id);
 return {kind:"selected" as const,event,reservation};
}

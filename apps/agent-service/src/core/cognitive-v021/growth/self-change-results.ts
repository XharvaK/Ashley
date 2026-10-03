// Authenticate operator observations; admission never grants acceptance, merge, or deployment authority.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants, type Dir } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveBudgetPolicy } from "../private-budget/policies.js";
import { getPrivateReservationForWake, reservePrivateThought } from "../private-budget/ledger.js";
import { SELF_CHANGE_POLICY_ID, SELF_CHANGE_WINDOW_MS } from "./self-change.js";
import type { DatabaseSync } from "node:sqlite";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";

export type SelfChangeResult = { version: 1; changesetId: string; proposalCommit: string; manifestSha256: string;
  outcome: "rejected" | "accepted" | "blocked" | "reverted"; decidedAtMs: number; decisionRef: string; summary: string };
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
    || Object.keys(value).some(key => !["version","changesetId","proposalCommit","manifestSha256","outcome","decidedAtMs","decisionRef","summary"].includes(key))) {
    throw new Error("self_change_result_invalid");
  }
  return { version: 1, changesetId: value.changesetId, proposalCommit: value.proposalCommit, manifestSha256: value.manifestSha256,
    outcome: value.outcome as SelfChangeResult["outcome"], decidedAtMs: Number(value.decidedAtMs), decisionRef: value.decisionRef, summary: value.summary };
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
 if (directory !== input.directory || (await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error("self_change_result_directory_invalid");
 const state = input.state ?? {};
 if (state.directory && state.directory !== directory) throw new Error("self_change_result_directory_changed");
 state.directory = directory;
 state.handle ??= await opendir(directory);
 try {
  // Keep an open directory cursor across maintenance passes; retained receipts cannot starve later files.
  for (let scanned = 0; scanned < 32; scanned++) {
   const entry = await state.handle.read();
   if (!entry) { await state.handle.close(); state.handle = undefined; break; }
   if (!entry.name.endsWith(".result.json")) continue;
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
    if (entry.name !== result.changesetId + ".result.json") throw new Error("self_change_result_filename_mismatch");
    const admitted = admitSelfChangeResult(db, { result, conversationId: input.conversationId, nowMs: input.nowMs });
    const event = admitted.event;
    const previous = getPrivateReservationForWake(db, event.wakeId!);
    if (previous && previous.policyId !== SELF_CHANGE_POLICY_ID) throw new Error("self_change_result_policy_conflict");
    if (!previous) {
     const reservation = reservePrivateThought(db, { admissionId: event.id, wakeId: event.wakeId!, conversationId: event.conversationId,
      policyId: SELF_CHANGE_POLICY_ID, wallClockNowMs: input.nowMs });
     if (reservation.kind !== "reserved") counts.budgetDeferred++;
    }
    counts[admitted.kind === "admitted" ? "admitted" : "existing"]++;
   } catch { counts.refused++; } // Never log signed result text, keys, or filesystem/transport details.
  }
 } finally {
  if (!input.state && state.handle) { await state.handle.close(); state.handle = undefined; }
 }
 return { status: "polled" as const, ...counts };
}

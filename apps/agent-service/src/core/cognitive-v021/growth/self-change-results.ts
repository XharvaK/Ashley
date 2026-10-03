// Authenticate operator observations; admission never grants acceptance, merge, or deployment authority.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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

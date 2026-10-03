import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
const results = await import("./self-change-results.js").catch(() => ({})) as typeof import("./self-change-results.js");
const secret = "fixture-only-authentication-key-32bytes";
const result = { version: 1, changesetId: "cs_fixture", proposalCommit: "a".repeat(40), manifestSha256: "b".repeat(64), outcome: "rejected", decidedAtMs: 10, decisionRef: "owner:fixture", summary: "Authored review result" };
function envelope(value = result) { const payload = JSON.stringify(value); return JSON.stringify({ payload, hmacSha256: createHmac("sha256", secret).update(payload).digest("hex") }); }
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

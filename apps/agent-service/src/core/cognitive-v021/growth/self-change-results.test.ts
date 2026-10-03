import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureSelfChangeBudget } from "./self-change.js";
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
 it("authenticates the file and binds one genuine reservation across retry", async () => {
  const poll = pollApi(); await fixture(async (db, directory) => {
   configureSelfChangeBudget(db, { limit: 3, version: 1 });
   await writeFile(join(directory, "cs_fixture.result.json"), envelope());
   const input = { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 11 };
   expect(await poll(db, input)).toMatchObject({ status: "polled", admitted: 1, refused: 0 });
   expect(await poll(db, { ...input, nowMs: 12 })).toMatchObject({ admitted: 0, existing: 1 });
   expect(db.prepare("SELECT count(*) AS n FROM private_budget_reservations WHERE policy_id='ashley.self_change.v1'").get()).toEqual({ n: 1 });
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
  await writeFile(join(directory, "cs_fixture.result.json"), envelope());
  expect(await results.pollSelfChangeResults(db, { enabled: true, directory, key: secret, conversationId: "private-self", nowMs: 12 })).toMatchObject({ admitted: 0, existing: 1 });
  expect(db.prepare("SELECT count(*) AS n FROM wakes").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT wake_id FROM private_budget_reservations").get()).toEqual({ wake_id: first.event.wakeId });
 } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

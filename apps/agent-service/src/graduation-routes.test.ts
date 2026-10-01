import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "./agent.js";
import { createServer } from "./server.js";
import { openTestSidecar, admitTestCycle } from "./core/cognitive-v021/test-support.js";
import { recordExpectations } from "./core/cognitive-v021/growth/expectations.js";
import { recordObservation } from "./core/cognitive-v021/graduation/observations.js";
vi.mock("./owner-auth.js", () => ({ isAuthorizedOwnerId: (id: string) => id === "owner-test" }));
async function fixture(run: (url: string, db: ReturnType<typeof openTestSidecar>) => Promise<void>) {
  const db = openTestSidecar(); const nuclear = new DatabaseSync(":memory:");
  const manager = { core: { getDatabase: () => nuclear } } as unknown as AgentManager;
  const app = createServer(manager, { cognitiveSidecar: db, botServiceToken: "fixture-token", ownerId: "owner-test" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture_address");
  try { await run(`http://127.0.0.1:${address.port}`, db); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); nuclear.close(); }
}
function post(url: string, path: string, body: object, actor = "owner-test") {
  return fetch(url + path, { method: "POST", headers: { "content-type": "application/json", "X-Ashley-Bot-Service": "fixture-token", "X-Ashley-Actor": actor }, body: JSON.stringify({ userId: "owner-test", ...body }) });
}
describe("Owner graduation routes", () => {
  it("shows sidecar diagnostics on both routes and refuses a nonowner", async () => fixture(async url => {
    for (const path of ["/growth/graduation", "/nuclear/cognitive-graduation"]) {
      const response = await fetch(`${url}${path}?owner_id=owner-test`, { headers: { "X-Ashley-Bot-Service": "fixture-token" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ mode: "observe", perClass: [], openProposals: [], admittedLines: [] });
    }
    expect((await fetch(`${url}/growth/graduation?owner_id=external`, { headers: { "X-Ashley-Bot-Service": "fixture-token" } })).status).toBe(403);
  }));
  it("requires authenticated Owner authority before changing mode and records actor/time", async () => fixture(async (url, db) => {
    expect((await post(url, "/growth/graduation/mode", { mode: "apply" }, "external")).status).toBe(403);
    expect(db.prepare("SELECT mode FROM graduation_contract_state").get()!.mode).toBe("observe");
    const response = await post(url, "/growth/graduation/mode", { mode: "dark_apply" });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT mode,actor,at_ms FROM graduation_contract_state").get()).toMatchObject({ mode: "dark_apply", actor: "owner-test", at_ms: expect.any(Number) });
    expect((await post(url, "/growth/graduation/mode", { mode: "unknown" })).status).toBe(400);
  }));
  it("rolls back eligible influence without deleting history", async () => fixture(async (url, db) => {
    db.prepare("INSERT INTO graduation_calibration(calibration_id,judgment_class,adjustment,lifecycle_state,proposed_cycle_id,data_classification,created_at_ms) VALUES ('fixture','class','increase_caution','eligible_for_future_thought','fixture','ordinary',1)").run();
    expect((await post(url, "/growth/calibration/rollback", {}, "external")).status).toBe(403);
    const response = await post(url, "/growth/calibration/rollback", {});
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ rolledBack: 1 });
    expect(db.prepare("SELECT lifecycle_state FROM graduation_calibration WHERE calibration_id='fixture'").get()!.lifecycle_state).toBe("rolled_back");
  }));
  it("records owner_confirmed as an explicit sidecar adjudication bound to a real cycle", async () => fixture(async (url, db) => {
    const cycle = admitTestCycle(db, { conversationId: "owner", triggerKind: "owner_message", triggerRef: "owner", nowMs: 1 });
    const [id] = recordExpectations(db, { cycleId: cycle.cycleId, statements: ["Prediction"], dataClassification: "ordinary", nowMs: 1 });
    const observation = recordObservation(db, { expectationId: id!, observableKind: "fixture", observationKind: "receipt_backed", observedValueTyped: true, operationalReceiptType: "fixture", operationalReceiptId: "fixture", nowMs: 2 });
    const response = await post(url, "/growth/graduation/adjudicate", { expectationId: id, observationId: observation.observationId, disposition: "confirmed", adjudicatingCycleId: cycle.cycleId });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT adjudication_authority,proposal_origin FROM graduation_adjudications").get()).toEqual({ adjudication_authority: "owner_confirmed", proposal_origin: "owner" });
    expect((await post(url, "/growth/graduation/adjudicate", { expectationId: id, observationId: observation.observationId, disposition: "confirmed", adjudicatingCycleId: cycle.cycleId }, "external")).status).toBe(403);
  }));
});

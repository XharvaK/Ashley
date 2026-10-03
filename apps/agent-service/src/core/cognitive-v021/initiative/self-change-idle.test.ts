// Prove that an authored self-change trigger uses its separate L1 policy and never borrows ordinary capacity.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { recordFriction } from "../growth/friction.js";
import { configureBudgetPolicy } from "../private-budget/policies.js";
import { scheduleFutureTrigger } from "./future-triggers.js";
import { tickIdleOpportunity } from "./idle.js";
const T = 1800000000000;
function seed(db: ReturnType<typeof openTestSidecar>, configured: boolean) {
  db.prepare(`INSERT INTO concerns (concern_id,conversation_id,statement,source_refs_json,dimensions_json,cognitive_status,snapshot_hash,objective_json)
    VALUES ('self','private','Thought chose to investigate a repair','[]','{}','active','snapshot',?)`)
    .run(JSON.stringify({ intendedOutcome: "investigate repair", target: { kind: "self_change", motiveKind: "friction_pattern", motiveRef: "effect_failed" } }));
  db.prepare(`INSERT INTO mind_occupancy (conversation_id,concern_id,status,priority,updated_cycle,updated_generation) VALUES ('private','self','active',20,'authored',1)`).run();
  for (let i = 0; i < 3; i++) recordFriction(db,{ kind: "effect_failed", subjectId: `effect${i}`, nowMs:T-i, dataClassification: "never_public" });
  if (configured) configureBudgetPolicy(db,{ policyId: "ashley.self_change.v1", version:1, limit:1, windowMs:86400000, clockDiscontinuityMs:300000 });
  scheduleFutureTrigger(db,{ triggerId: "authored-trigger", conversationId:"private", concernId:"self", snapshotHash:"snapshot", dueAtMs:T, payload:{ budgetPolicyId:"ashley.self_change.v1" } });
}
describe("S1 existing idle admission consumer", () => {
  it("refuses a configured policy with the wrong window", async () => {
    const db = openTestSidecar(); try {
      seed(db,true);
      configureBudgetPolicy(db,{ policyId:"ashley.self_change.v1",version:2,limit:1,windowMs:3600000,clockDiscontinuityMs:300000 });
      let calls = 0;
      const result = await tickIdleOpportunity(db,{ conversationId:"private",nowMs:T,runThought:async()=> {
        calls++;return {published:false,outboxId:null,thoughtModelAttempts:0,speechMode:"none" as const};
      } });
      expect(calls).toBe(0); expect(result.reason).toBe("self_change_budget_policy_invalid");
    } finally { db.close(); }
  });
  it("refuses a declared self-change pass with insufficient factual motive", async () => {
    const db = openTestSidecar(); try {
      seed(db,true); db.prepare("DELETE FROM friction_events").run(); let calls = 0;
      const result = await tickIdleOpportunity(db,{ conversationId:"private", nowMs:T, runThought: async () => {
        calls++; return { published:false, outboxId:null, thoughtModelAttempts:0, speechMode:"none" as const };
      } });
      expect(calls).toBe(0); expect(result.reason).toBe("self_change_motive_unavailable");
      expect(db.prepare("SELECT COUNT(*) AS n FROM private_budget_reservations").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("binds the actual private reservation to the self-change policy", async () => {
    const db = openTestSidecar(); try {
      seed(db,true); let observedPolicy: unknown;
      await tickIdleOpportunity(db,{ conversationId:"private", nowMs:T, runThought: async input => {
        observedPolicy = db.prepare("SELECT policy_id FROM private_budget_reservations WHERE wake_id=?").get(input.wakeId)?.policy_id;
        return { published:false, outboxId:null, thoughtModelAttempts:0, speechMode:"none" as const };
      } });
      expect(observedPolicy).toBe("ashley.self_change.v1");
    } finally { db.close(); }
  });
  it("refuses an unconfigured self-change opportunity instead of spending ordinary budget", async () => {
    const db = openTestSidecar(); try {
      seed(db,false); let calls = 0;
      const result = await tickIdleOpportunity(db,{ conversationId:"private", nowMs:T, runThought: async () => {
        calls++; return { published:false, outboxId:null, thoughtModelAttempts:0, speechMode:"none" as const };
      } });
      expect(calls).toBe(0);
      expect(result.reason).toBe("self_change_budget_unconfigured");
      expect(db.prepare("SELECT COUNT(*) AS n FROM private_budget_reservations").get()?.n).toBe(0);
    } finally { db.close(); }
  });
});

// Falsify self-change facts and policy isolation without inventing a concern or dispatch.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { recordFriction } from "./friction.js";
import { getPrivateBudgetProjection, reservePrivateThought } from "../private-budget/ledger.js";
import { admitWake } from "../wake/ledger.js";
import { growthForThought } from "./growth.js";
import { proposeRevisions } from "./revisions.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
const port = await import("./" + "self-change.js").catch(() => null);
const T = 1800000000000;
function api() { expect(typeof port?.selfChangeMotivesForThought).toBe("function"); return port!; }
describe("S1 factual motives and separate L1 policy", () => {
  it("carries the authored target and trigger through the existing semantic contract", () => {
    expect(parseThoughtSemanticOutput({ kind:"settlement", speech:{mode:"none"}, concernDeltas:[{ op:"upsert", record:{
      identity:{kind:"local",alias:"repair"}, statement:"Investigate a repair", sourceTurnRefs:[],
      dimensions:{source:"ashley_interpretation",status:"interpreted",time:"current",reliability:"inferred"}, status:"active",
      objective:{intendedOutcome:"investigate",target:{kind:"self_change",motiveKind:"friction_pattern",motiveRef:"effect_failed"}},
    }}], futureTriggerDeltas:[{op:"create",concernRef:{kind:"local",alias:"repair"},dueAtMs:T,purpose:"revisit the repair",payload:{budgetPolicyId:"ashley.self_change.v1"}}] },new Set())).toMatchObject({ok:true});
  });
  it("reaches the existing private Thought growth projection with the actual proposed practice identity", () => {
    const db = openTestSidecar(); try {
      recordFriction(db,{ frictionId:"basis", kind:"self_reported", cycleId:"origin", nowMs:T, dataClassification:"ordinary" });
      const proposal = proposeRevisions(db,{ cycleId:"authored", proposals:[{ layer:"practice", topic:"checking", text:"Check before answering", rationale:"experience", evidenceRefs:["friction:basis"] }], identity:null, nowMs:T })[0]!;
      expect(proposal.outcome).toBe("proposed");
      expect((growthForThought(db,null,T) as any).selfChange).toMatchObject({ proposedPractices:[{ revisionId:(proposal as any).revisionId, text:"Check before answering" }] });
      expect(db.prepare("SELECT COUNT(*) AS n FROM concerns").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("shows only same-kind patterns of at least three events in the seven-day window and creates no concern", () => {
    const p = api(), db = openTestSidecar(); try {
      for (let i = 0; i < 3; i++) recordFriction(db, { kind: "effect_failed", subjectId: `effect${i}`, nowMs: T-i, dataClassification: "never_public" });
      recordFriction(db, { kind: "delivery_failed", nowMs: T, dataClassification: "ordinary" });
      recordFriction(db, { kind: "delivery_failed", nowMs: T - 7*86400000 - 1, dataClassification: "ordinary" });
      recordFriction(db, { kind: "delivery_failed", nowMs: T+1, dataClassification: "ordinary" });
      expect(p.selfChangeMotivesForThought(db,T).frictionPatterns).toEqual([{ kind: "effect_failed", count: 3 }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM concerns").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("requires the Owner's positive numeric limit and configures only the 24-hour self-change policy", () => {
    const p = api(), db = openTestSidecar(); try {
      expect(() => p.configureSelfChangeBudget(db, { limit: undefined as never, version: 1 })).toThrow();
      expect(() => getPrivateBudgetProjection(db,{ policyId: "ashley.self_change.v1", wallClockNowMs: T })).toThrow("private_budget_policy_unconfigured");
      p.configureSelfChangeBudget(db,{ limit: 1, version: 1 });
      for (let i = 0; i < 2; i++) {
        const w = admitWake(db,{ occurrenceId: `self${i}`, triggerRef: `self${i}`, sourceKind: "idle", conversationId: "private", capturedAuthorityRevision: 1, nowMs:T });
        expect(reservePrivateThought(db,{ admissionId: `self${i}`, wakeId: w.wake.wakeId, conversationId: "private", policyId: "ashley.self_change.v1", wallClockNowMs:T }).kind).toBe(i === 0 ? "reserved" : "refused");
      }
      expect(getPrivateBudgetProjection(db,{ policyId: "ashley.self_change.v1", wallClockNowMs:T })).toMatchObject({ limit: 1, windowMs: 86400000, remaining: 0 });
      expect(getPrivateBudgetProjection(db,{ policyId: "ashley.private_thought.v1", wallClockNowMs:T }).remaining).toBe(12);
    } finally { db.close(); }
  });
});

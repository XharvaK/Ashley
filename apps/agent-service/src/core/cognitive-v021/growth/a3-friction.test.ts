// The Host records that friction happened; only Thought says what it means.
import { describe, it, expect } from "vitest";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { isValidGrowthClaim } from "./claim.js";
import { recordGrowth, growthForThought } from "./growth.js";
import { recordExpectations, checkExpectations } from "./expectations.js";
import { putInFlight, markInFlightUnknown, recordEffectReceipt } from "../effect/in-flight.js";
const T = 1000000;
function ready(db: ReturnType<typeof openTestSidecar>) {
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'friction_events'").get(), "friction ledger exists").toBeDefined();
}
function count(db: ReturnType<typeof openTestSidecar>, kind: string) { return Number(db.prepare("SELECT count(*) AS n FROM friction_events WHERE kind = ?").get(kind)!.n); }
describe("A3a friction", () => {
  it.each([false, true])("creates a fresh/upgraded ledger (%s)", (upgrade) => {
    const db = openTestSidecar();
    try {
      if (upgrade) {
        db.exec("DROP TABLE IF EXISTS friction_events; PRAGMA user_version = 45");
        db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 45").run();
        openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      }
      ready(db);
      expect(db.prepare("PRAGMA table_info(friction_events)").all().map(r => r.name)).toContain("subject_id");
    } finally { db.close(); }
  });
  it("unknown transitions and later receipts deduplicate by effect", () => {
    const db = openTestSidecar();
    try {
      ready(db);
      admitTestCycle(db, { cycleId: "c", conversationId: "t", triggerKind: "owner_message", triggerRef: "e", occupantId: "doc", nowMs: T });
      putInFlight(db, { effectId: "f", cycleId: "c", generation: 1, correlationId: "r", idempotencyKey: "i", originEventId: "e" });
      expect(count(db, "outcome_unknown")).toBe(0);
      markInFlightUnknown(db, "f", T);
      markInFlightUnknown(db, "f", T);
      recordEffectReceipt(db, { receiptId: "r", effectId: "f", idempotencyKey: "i", outcome: "outcome_unknown", claims: {}, atMs: T, dataClassification: "ordinary", secretOmitted: false });
      expect(count(db, "outcome_unknown")).toBe(1);
    } finally { db.close(); }
  });
  it.each(["failed", "outcome_unknown"] as const)("records %s receipts once and no successful friction", (outcome) => {
    const db = openTestSidecar();
    try {
      ready(db);
      const receipt = { receiptId: "r", effectId: "f", idempotencyKey: "i", outcome, claims: { executionTruth: "no_effect_proven" }, atMs: T, dataClassification: "ordinary" as const, secretOmitted: false };
      recordEffectReceipt(db, { ...receipt, effectId: "ok", receiptId: "ok", idempotencyKey: "ok", outcome: "succeeded" });
      expect(count(db, "effect_failed") + count(db, "outcome_unknown")).toBe(0);
      recordEffectReceipt(db, receipt); recordEffectReceipt(db, receipt);
      expect(count(db, outcome === "failed" ? "effect_failed" : "outcome_unknown")).toBe(1);
    } finally { db.close(); }
  });
  it("records missed expectations once, with code-only notes", () => {
    const db = openTestSidecar();
    try {
      ready(db);
      const ids = recordExpectations(db, { cycleId: "c", statements: ["CONTENT_SECRET", "ok"], nowMs: T, dataClassification: "ordinary" });
      checkExpectations(db, { cycleId: "later", checks: [{ expectationId: ids[1]!, outcome: "met", lesson: "CONTENT_SECRET" }], nowMs: T });
      expect(count(db, "expectation_missed")).toBe(0);
      const checks = [{ expectationId: ids[0]!, outcome: "missed" as const, lesson: "CONTENT_SECRET" }];
      checkExpectations(db, { cycleId: "later", checks, nowMs: T }); checkExpectations(db, { cycleId: "later", checks, nowMs: T });
      expect(count(db, "expectation_missed")).toBe(1);
      expect(JSON.stringify(db.prepare("SELECT note FROM friction_events").all())).not.toContain("CONTENT_SECRET");
    } finally { db.close(); }
  });
  it("accepts only two Thought kinds and at most two entries", () => {
    const friction = [{ kind: "owner_correction", note: "my reading", refs: [] }, { kind: "self_reported", note: "my reading", refs: [] }];
    expect(isValidGrowthClaim({ friction }), "Thought friction accepted").toBe(true);
    expect(isValidGrowthClaim({ friction: [...friction, friction[0]] })).toBe(false);
    expect(isValidGrowthClaim({ friction: [{ ...friction[0], kind: "effect_failed" }] })).toBe(false);
  });
  it("omits secret Thought notes and bounds recent projection", () => {
    const db = openTestSidecar();
    try {
      ready(db);
      for (let n = 0; n < 6; n++) recordGrowth(db, { cycleId: `c${n}`, claim: { friction: [{ kind: "self_reported", note: `note${n}`, refs: [] }] } as any, identityStore: null, dataClassification: "ordinary", nowMs: T+n });
      recordGrowth(db, { cycleId: "secret", claim: { friction: [{ kind: "self_reported", note: "SECRET", refs: [] }] } as any, identityStore: null, dataClassification: "secret", nowMs: T+7 });
      expect(JSON.stringify(db.prepare("SELECT note FROM friction_events").all())).not.toContain("SECRET");
      expect((growthForThought(db, null, T+10) as any).friction.recent).toHaveLength(5);
    } finally { db.close(); }
  });
  it("failed friction insertion preserves receipt terminal truth", () => {
    const db = openTestSidecar();
    try {
      ready(db);
      db.exec("CREATE TRIGGER friction_fault BEFORE INSERT ON friction_events BEGIN SELECT RAISE(ABORT, 'fault'); END");
      expect(recordEffectReceipt(db, { receiptId: "r", effectId: "f", idempotencyKey: "i", outcome: "failed", claims: {}, atMs: T, dataClassification: "ordinary", secretOmitted: false }).outcome).toBe("failed");
    } finally { db.close(); }
  });
});

describe("A3a schema contract and failures", () => {
  it("validates the friction schema contract and detects a missing index", async () => {
    const contract = await import("../../cognition/schema-contract.js") as any;
    expect(contract.validateA3SidecarSchema, "sidecar schema contract exists").toBeTypeOf("function");
    const db = openTestSidecar();
    try {
      expect(() => contract.validateA3SidecarSchema(db, 46)).not.toThrow();
      db.exec("DROP INDEX idx_friction_subject");
      expect(() => contract.validateA3SidecarSchema(db, 46)).toThrow();
    } finally { db.close(); }
  });
  it("failed friction insertion preserves missed expectation and unknown transition", () => {
    const db = openTestSidecar();
    try {
      ready(db);
      db.exec("CREATE TRIGGER friction_fault BEFORE INSERT ON friction_events BEGIN SELECT RAISE(ABORT, 'fault'); END");
      const [id] = recordExpectations(db, { cycleId: "c", statements: ["expected"], dataClassification: "ordinary", nowMs: T });
      expect(checkExpectations(db, { cycleId: "later", checks: [{ expectationId: id!, outcome: "missed", lesson: "lesson" }], nowMs: T })).toEqual([id]);
      admitTestCycle(db, { cycleId: "c", conversationId: "t", triggerKind: "owner_message", triggerRef: "e", occupantId: "doc", nowMs: T });
      putInFlight(db, { effectId: "f", cycleId: "c", generation: 1, correlationId: "r", idempotencyKey: "i", originEventId: "e" });
      expect(markInFlightUnknown(db, "f", T).status).toBe("unknown");
      expect(recordEffectReceipt(db, { receiptId: "r", effectId: "f", idempotencyKey: "i", outcome: "outcome_unknown", claims: {}, atMs: T, dataClassification: "ordinary", secretOmitted: false }).outcome).toBe("outcome_unknown");
    } finally { db.close(); }
  });
});

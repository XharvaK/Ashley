// Host proposals are counted evidence; only a later Thought pass admits calibration.
import { describe, expect, it } from "vitest";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordExpectations } from "../growth/expectations.js";
import { growthForThought, recordGrowth } from "../growth/growth.js";
import { isValidGrowthClaim } from "../growth/claim.js";
import { recordObservation } from "./observations.js";
import { recordAdjudication } from "./adjudications.js";

const DAY = 86_400_000;
const NOW = 40 * DAY;
function seed(db: ReturnType<typeof openTestSidecar>, cls: string, outcomes: boolean[], atMs = NOW) {
  outcomes.forEach((confirmed, index) => {
    const [id] = recordExpectations(db, { cycleId: `${cls}:${index}`, statements: [{ statement: "A bounded prediction", judgmentClass: cls, observable: '{"observed":true}' }], dataClassification: "ordinary", nowMs: atMs });
    const observation = recordObservation(db, { expectationId: id!, observableKind: "fixture", observationKind: "receipt_backed", observedValueTyped: { observed: confirmed }, operationalReceiptType: "fixture", operationalReceiptId: `${cls}:${index}`, nowMs: atMs });
    recordAdjudication(db, { expectationId: id!, observationId: observation.observationId, disposition: confirmed ? "confirmed" : "contradicted", proposalOrigin: "deterministic_extractor", hostValidationOk: true, adjudicationAuthority: "deterministic_compare", comparatorPolicyVersion: "typed-json-v1", nowMs: atMs });
  });
}
function pass(db: ReturnType<typeof openTestSidecar>, id: string, nowMs: number) {
  return admitTestCycle(db, { conversationId: id, triggerKind: "owner_message", triggerRef: id, nowMs }).cycleId;
}
function settle(db: ReturnType<typeof openTestSidecar>, cycleId: string, nowMs: number, claim?: Parameters<typeof recordGrowth>[1]["claim"]) {
  return recordGrowth(db, { cycleId, claim, identityStore: null, dataClassification: "ordinary", nowMs });
}
function rows(db: ReturnType<typeof openTestSidecar>) { return db.prepare("SELECT * FROM graduation_calibration ORDER BY rowid").all(); }

describe("graduation calibration", () => {
  it("requires four determinate adjudications and one open proposal per class", () => {
    const db = openTestSidecar();
    try {
      seed(db, "three", [false, false, true]);
      settle(db, pass(db, "first", NOW), NOW);
      expect(rows(db)).toHaveLength(0);
      seed(db, "four", [false, false, true, true]);
      settle(db, pass(db, "second", NOW + 1), NOW + 1);
      expect(rows(db)).toHaveLength(1);
      expect(rows(db)[0]).toMatchObject({ judgment_class: "four", adjustment: "increase_caution", lifecycle_state: "proposed" });
      settle(db, pass(db, "third", NOW + 2), NOW + 2);
      expect(rows(db)).toHaveLength(1);
    } finally { db.close(); }
  });
  it("includes exactly 0.15 and excludes the middle band", () => {
    const db = openTestSidecar();
    try {
      seed(db, "low", Array.from({ length: 20 }, (_, i) => i >= 3));
      seed(db, "middle", [false, true, true, true]);
      settle(db, pass(db, "ratio", NOW), NOW);
      expect(rows(db)).toHaveLength(1);
      expect(rows(db)[0]).toMatchObject({ judgment_class: "low", adjustment: "decrease_caution" });
    } finally { db.close(); }
  });
  it("includes the 30-day edge and excludes the earlier instant", () => {
    const db = openTestSidecar();
    try {
      seed(db, "edge", [false, true, true], NOW);
      const [id] = recordExpectations(db, { cycleId: "edge-old", statements: [{ statement: "A prediction", judgmentClass: "edge", observable: "true" }], dataClassification: "ordinary", nowMs: NOW - 30 * DAY });
      const obs = recordObservation(db, { expectationId: id!, observableKind: "fixture", observationKind: "receipt_backed", observedValueTyped: false, operationalReceiptType: "fixture", operationalReceiptId: "edge-old", nowMs: NOW - 30 * DAY });
      recordAdjudication(db, { expectationId: id!, observationId: obs.observationId, disposition: "contradicted", proposalOrigin: "worker", hostValidationOk: true, adjudicationAuthority: "deterministic_compare", comparatorPolicyVersion: "typed-json-v1", nowMs: NOW - 30 * DAY });
      settle(db, pass(db, "window", NOW), NOW);
      expect(rows(db)).toHaveLength(1);
      const other = openTestSidecar();
      try { seed(other, "outside", [false, false, true, true], NOW - 30 * DAY - 1); settle(other, pass(other, "outside", NOW), NOW); expect(rows(other)).toHaveLength(0); } finally { other.close(); }
    } finally { db.close(); }
  });
  it.each(["observe", "dark_apply"])("hides graduation in %s and shows proposals only in apply", mode => {
    const db = openTestSidecar();
    try {
      seed(db, "reply", [false, false, true, true]);
      settle(db, pass(db, "proposal", NOW), NOW);
      expect(rows(db)).toHaveLength(1);
      const proposalId = String(rows(db)[0]!.calibration_id);
      db.prepare("UPDATE graduation_contract_state SET mode=? WHERE id=1").run(mode);
      const hidden = growthForThought(db, null, NOW);
      expect(hidden).not.toHaveProperty("calibrationProposals");
      expect(hidden).not.toHaveProperty("calibration");
      db.exec("UPDATE graduation_contract_state SET mode='apply' WHERE id=1");
      expect(growthForThought(db, null, NOW)).toMatchObject({ calibrationProposals: [{ calibrationId: proposalId, class: "reply", adjustment: "increase_caution" }] });
    } finally { db.close(); }
  });
  it("accepts at most three bounded calibration positions in the contract", () => {
    const position = { calibrationId: "proposal", position: "admit", rationale: "The evidence warrants caution" };
    expect(isValidGrowthClaim({ calibrationPositions: [position] })).toBe(true);
    expect(isValidGrowthClaim({ calibrationPositions: [position, position, position, position] })).toBe(false);
    expect(isValidGrowthClaim({ calibrationPositions: [{ ...position, rationale: "x".repeat(201) }] })).toBe(false);
  });
  it("requires a later pass for admission and keeps decline out of Thought", () => {
    const db = openTestSidecar();
    try {
      db.exec("UPDATE graduation_contract_state SET mode='apply' WHERE id=1");
      seed(db, "admit", [false, false, true, true]);
      seed(db, "decline", [false, false, true, true]);
      const first = pass(db, "proposing", NOW);
      settle(db, first, NOW);
      expect(rows(db)).toHaveLength(2);
      const id = String(rows(db).find(row => row.judgment_class === "admit")!.calibration_id);
      const declineId = String(rows(db).find(row => row.judgment_class === "decline")!.calibration_id);
      const claim = { appraisal: { note: "A later reading" }, calibrationPositions: [{ calibrationId: id, position: "admit" as const, rationale: "I admit this" }] };
      settle(db, first, NOW + 1, claim);
      expect(rows(db).find(row => row.judgment_class === "admit")!.lifecycle_state).toBe("proposed");
      const later = pass(db, "admitting", NOW + 2);
      settle(db, later, NOW + 2, { ...claim, calibrationPositions: [...claim.calibrationPositions, { calibrationId: declineId, position: "decline", rationale: "I decline this" }] });
      expect(growthForThought(db, null, NOW + 3)).toMatchObject({ calibration: [{ class: "admit", adjustment: "increase_caution", sinceMs: NOW + 2 }] });
    } finally { db.close(); }
  });
});

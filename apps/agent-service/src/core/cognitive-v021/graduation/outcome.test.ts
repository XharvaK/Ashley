// The observation and adjudication layers retain the legacy C4 outcome semantics.
import { describe, expect, it } from "vitest";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordExpectations } from "../growth/expectations.js";
import { recordObservation, listObservations } from "./observations.js";
import { recordAdjudication, listAdjudications } from "./adjudications.js";

function fixture() {
  const db = openTestSidecar();
  db.exec("UPDATE graduation_contract_state SET mode='dark_apply' WHERE id=1");
  const cycle = admitTestCycle(db, { conversationId: "c4-port-fixture", triggerRef: "c4-port-fixture", triggerKind: "owner_message", architectureEpoch: "v0.2.1", occupantId: "fixture", authorityEpoch: 1, nowMs: 1 });
  const [id] = recordExpectations(db, { cycleId: cycle.cycleId, statements: [{ statement: "A bounded prediction", observable: '{"observed":true}' }], dataClassification: "ordinary", nowMs: 1 });
  return { db, id: id!, cycleId: cycle.cycleId };
}

describe("ported C4 operational observations and semantic adjudication", () => {
  it("requires a later actual value or evidence binding, and does not adjudicate on receipt", () => {
    const { db, id } = fixture();
    try {
      expect(() => recordObservation(db, { expectationId: id, observableKind: "fixture", observationKind: "receipt_backed", operationalReceiptType: "fixture_receipt", operationalReceiptId: "attempt-1" })).toThrow("cognitive_graduation_observed_value_required");
      const observation = recordObservation(db, { expectationId: id, observableKind: "fixture", observedValueTyped: { observed: true }, observationKind: "receipt_backed", operationalReceiptType: "fixture_receipt", operationalReceiptId: "attempt-1" });
      expect(observation).toMatchObject({ expectationId: id, observationKind: "receipt_backed", observedValueTyped: { observed: true }, provenance: "live" });
      expect(listAdjudications(db, id)).toEqual([]);
      expect(db.prepare("SELECT graduation_lifecycle AS lifecycle_state FROM expectations WHERE expectation_id=?").get(id)).toEqual({ lifecycle_state: "observation_available" });
    } finally { db.close(); }
  });
  it("allows missing and OUTCOME_UNKNOWN without treating either as a failed retry", () => {
    const { db, id } = fixture();
    try {
      const missing = recordObservation(db, { expectationId: id, observableKind: "fixture", observationKind: "missing" });
      expect(missing).toMatchObject({ observationKind: "missing" });
      expect(() => recordObservation(db, { expectationId: id, observableKind: "fixture", observedValueTyped: false, observationKind: "outcome_unknown" })).toThrow("cognitive_graduation_unknown_observation_value_refused");
      const unknown = recordObservation(db, { expectationId: id, observableKind: "fixture", observationKind: "outcome_unknown" });
      expect(unknown).toMatchObject({ observationKind: "outcome_unknown" });
      expect(listAdjudications(db, id)).toHaveLength(0);
    } finally { db.close(); }
  });
  it("uses deterministic comparison only for typed comparable values and keeps later adjudications append-only", () => {
    const { db, id } = fixture();
    try {
      const observation = recordObservation(db, { expectationId: id, observableKind: "fixture", observedValueTyped: { observed: true }, observationKind: "receipt_backed", operationalReceiptType: "fixture_receipt", operationalReceiptId: "attempt-2" });
      expect(observation).toBeDefined();
      const first = recordAdjudication(db, { expectationId: id, observationId: observation.observationId, disposition: "confirmed", proposalOrigin: "deterministic_extractor", hostValidationOk: true, adjudicationAuthority: "deterministic_compare", comparatorPolicyVersion: "typed-json-v1" });
      expect(first).toMatchObject({ disposition: "confirmed", adjudicationAuthority: "deterministic_compare", adjudicatingCycleId: null, comparatorPolicyVersion: "typed-json-v1" });
      const second = recordObservation(db, { expectationId: id, observableKind: "fixture", observedValueTyped: { observed: false }, observationKind: "receipt_backed", operationalReceiptType: "fixture_receipt", operationalReceiptId: "attempt-3" });
      const contradicted = recordAdjudication(db, { expectationId: id, observationId: second.observationId, disposition: "contradicted", proposalOrigin: "worker", hostValidationOk: true, adjudicationAuthority: "deterministic_compare", comparatorPolicyVersion: "typed-json-v1", supersedesAdjudicationId: first.adjudicationId, correctionClass: "SCOPE_REFINEMENT" });
      expect(listAdjudications(db, id)).toHaveLength(2);
      expect(contradicted.supersedesAdjudicationId).toBe(first.adjudicationId);
      expect(db.prepare("SELECT graduation_lifecycle AS lifecycle_state FROM expectations WHERE expectation_id=?").get(id)).toEqual({ lifecycle_state: "closed" });
      expect(() => db.prepare("UPDATE graduation_adjudications SET disposition='unresolved' WHERE adjudication_id=?").run(first.adjudicationId)).toThrow("cognitive_adjudication_append_only");
      expect(() => db.prepare("DELETE FROM graduation_observations WHERE observation_id=?").run(observation.observationId)).toThrow("cognitive_observation_append_only");
    } finally { db.close(); }
  });
  it("rejects proposed reflection authority, invalid host admission, and semantic claims over unknown outcomes", () => {
    const { db, id, cycleId } = fixture();
    try {
      const unknown = recordObservation(db, { expectationId: id, observableKind: "fixture", observationKind: "outcome_unknown" });
      expect(unknown).toBeDefined();
      const base = { expectationId: id, observationId: unknown.observationId, proposalOrigin: "model", hostValidationOk: true, adjudicationAuthority: "ashley_thought_reflection", adjudicatingCycleId: cycleId } as const;
      expect(() => recordAdjudication(db, { ...base, disposition: "confirmed" })).toThrow("cognitive_graduation_unknown_outcome_unresolved_required");
      expect(() => recordAdjudication(db, { ...base, disposition: "unresolved", hostValidationOk: false })).toThrow("cognitive_graduation_host_validation_required");
      expect(() => recordAdjudication(db, { ...base, disposition: "unresolved", adjudicationAuthority: "thought_reflection_proposed" as never })).toThrow("cognitive_graduation_proposed_authority_forbidden");
    } finally { db.close(); }
  });
  it("supports exact evidence plus content binding when a typed value is not copied", () => {
    const { db, id, cycleId } = fixture();
    try {
      const observation = recordObservation(db, { expectationId: id, observableKind: "delivery_content", observationEvidenceRef: "delivery_reservation:1", observationContentBinding: "sha256:fixture-content", observationKind: "receipt_backed", operationalReceiptType: "fixture_receipt", operationalReceiptId: "attempt-bound" });
      expect(observation).toBeDefined();
      expect(observation.observedValueTyped).toBeNull();
      expect(listObservations(db, id)).toHaveLength(1);
      const adjudication = recordAdjudication(db, { expectationId: id, observationId: observation.observationId, disposition: "partial_support", proposalOrigin: "worker", hostValidationOk: true, adjudicationAuthority: "ashley_thought_reflection", adjudicatingCycleId: cycleId });
      expect(adjudication.disposition).toBe("partial_support");
    } finally { db.close(); }
  });
});

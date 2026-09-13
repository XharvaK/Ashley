import { describe, expect, it } from "vitest";
import type { Observation } from "../types.js";
import { openTestSidecar } from "../test-support.js";
import {
  observationBindingHash,
  persistOrVerifyObservation,
  persistOrVerifyObservations,
  recoverObservationBindingForCycle,
  resolveObservationBinding,
} from "./persistence.js";

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationId: "observation:one",
    cycleId: "cycle:original",
    generation: 1,
    derived: false,
    replaySafe: true,
    modality: "text",
    payload: { text: "canonical evidence" },
    provenance: "test:source",
    dataClassification: "ordinary",
    secretOmitted: false,
    ...overrides,
  };
}

describe("P2 observation persistence and binding", () => {
  it("preserves canonical semantics while remapping an identical reused ID", () => {
    const db = openTestSidecar();
    try {
      const first = persistOrVerifyObservation(db, observation(), 100);
      const reused = persistOrVerifyObservation(db, observation({ cycleId: "cycle:next", generation: 9 }), 200);

      expect(reused).toEqual(first);
      expect(db.prepare("SELECT cycle_id, generation, created_at_ms FROM observations WHERE observation_id = ?").get("observation:one"))
        .toMatchObject({ cycle_id: "cycle:next", generation: 9, created_at_ms: 100 });
    } finally {
      db.close();
    }
  });

  it("rejects a semantic collision without overwriting the canonical row", () => {
    const db = openTestSidecar();
    try {
      persistOrVerifyObservation(db, observation(), 100);

      expect(() => persistOrVerifyObservation(db, observation({ payload: { text: "different evidence" } }), 200))
        .toThrow("observation_binding_conflict");
      expect(db.prepare("SELECT payload_json, cycle_id, generation, created_at_ms FROM observations WHERE observation_id = ?").get("observation:one"))
        .toMatchObject({
          payload_json: JSON.stringify({ text: "canonical evidence" }),
          cycle_id: "cycle:original",
          generation: 1,
          created_at_ms: 100,
        });
    } finally {
      db.close();
    }
  });

  it("binds ordered IDs to exact canonical semantics, independent of mechanical remapping", () => {
    const db = openTestSidecar();
    try {
      const one = observation();
      const two = observation({ observationId: "observation:two", payload: { text: "second" } });
      const first = persistOrVerifyObservations(db, [one, two], 100);
      const remapped = persistOrVerifyObservations(db, [
        { ...one, cycleId: "cycle:remapped", generation: 7 },
        { ...two, cycleId: "cycle:remapped", generation: 7 },
      ], 200);

      expect(remapped.observationBindingHash).toBe(first.observationBindingHash);
      expect(observationBindingHash({
        observationIds: ["observation:two", "observation:one"],
        observations: [first.canonicalObservations[1], first.canonicalObservations[0]],
      })).not.toBe(first.observationBindingHash);
    } finally {
      db.close();
    }
  });

  it("recovers a non-empty cycle binding and fails closed when the cycle has no rows", () => {
    const db = openTestSidecar();
    try {
      const stored = persistOrVerifyObservations(db, [observation()], 100);
      const recovered = recoverObservationBindingForCycle(db, {
        cycleId: "cycle:original",
        generation: 1,
      });
      expect(recovered).toMatchObject({
        kind: "known",
        capture: "present",
        observationIds: stored.observationIds,
        observationCount: stored.observationCount,
        observationBindingHash: stored.observationBindingHash,
      });
      expect(recovered.kind === "known" ? recovered.observations : []).toEqual([
        expect.objectContaining({ observationId: "observation:one", cycleId: "cycle:original", generation: 1 }),
      ]);
      expect(recoverObservationBindingForCycle(db, {
        cycleId: "cycle:empty",
        generation: 1,
      })).toEqual({ kind: "unknown", reason: "observation_binding_missing" });
    } finally {
      db.close();
    }
  });

  it("does not infer a multi-observation order from IDs or reused timestamps", () => {
    const db = openTestSidecar();
    try {
      const laterLexical = observation({ observationId: "observation:z", payload: { text: "first" } });
      const earlierLexical = observation({ observationId: "observation:a", payload: { text: "second" } });
      const original = persistOrVerifyObservations(db, [laterLexical, earlierLexical], 100);
      persistOrVerifyObservations(db, [
        { ...laterLexical, cycleId: "cycle:restarted", generation: 2 },
        { ...earlierLexical, cycleId: "cycle:restarted", generation: 2 },
      ], 1_000);

      expect(db.prepare(
        "SELECT observation_id, created_at_ms FROM observations WHERE cycle_id = ? ORDER BY observation_id",
      ).all("cycle:restarted")).toEqual([
        { observation_id: "observation:a", created_at_ms: 100 },
        { observation_id: "observation:z", created_at_ms: 100 },
      ]);
      expect(original.observationIds).toEqual(["observation:z", "observation:a"]);
      expect(recoverObservationBindingForCycle(db, {
        cycleId: "cycle:restarted",
        generation: 2,
      })).toEqual({ kind: "unknown", reason: "observation_binding_order_unproven" });
    } finally {
      db.close();
    }
  });

  it("resolves present and explicit empty bindings, and fails closed for unknown bindings", () => {
    const db = openTestSidecar();
    try {
      const stored = persistOrVerifyObservations(db, [observation()], 100);
      const present = resolveObservationBinding(db, {
        observationsCapture: "present",
        observationIds: stored.observationIds,
        observationCount: 1,
        observationBindingHash: stored.observationBindingHash,
      }, { cycleId: "cycle:recovered", generation: 11 });
      expect(present).toMatchObject({ kind: "known", capture: "present" });
      expect(present.kind === "known" ? present.observations : []).toEqual([
        expect.objectContaining({ observationId: "observation:one", cycleId: "cycle:recovered", generation: 11 }),
      ]);

      const emptyHash = observationBindingHash({ observationIds: [], observations: [] });
      expect(resolveObservationBinding(db, {
        observationsCapture: "none",
        observationIds: [],
        observationCount: 0,
        observationBindingHash: emptyHash,
      }, { cycleId: "cycle:empty", generation: 1 })).toMatchObject({ kind: "known", observations: [] });

      expect(resolveObservationBinding(db, { periodicScheduleOccurrenceId: "legacy" }, { cycleId: "cycle:legacy", generation: 1 }))
        .toMatchObject({ kind: "unknown", reason: "legacy_observation_binding_missing" });
      expect(resolveObservationBinding(db, {
        observationsCapture: "present",
        observationIds: ["observation:missing"],
        observationCount: 1,
        observationBindingHash: stored.observationBindingHash,
      }, { cycleId: "cycle:missing", generation: 1 })).toMatchObject({ kind: "unknown", reason: "observation_row_missing" });
      expect(resolveObservationBinding(db, {
        observationsCapture: "present",
        observationIds: stored.observationIds,
        observationCount: 1,
        observationBindingHash: "wrong",
      }, { cycleId: "cycle:hash", generation: 1 })).toMatchObject({ kind: "unknown", reason: "observation_binding_hash_mismatch" });
    } finally {
      db.close();
    }
  });
});

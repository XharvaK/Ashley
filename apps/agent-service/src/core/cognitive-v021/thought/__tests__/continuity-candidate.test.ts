import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyAuthoritativeInvalidations,
  createContinuityCandidate,
  type ContinuityCandidate,
} from "../continuity-candidate.js";
import { ensureAuthoritativeLineage, openContinuityDb } from "../../../continuity/db.js";

function makeCandidate(overrides: Partial<ContinuityCandidate<{ text: string }>> = {}) {
  return createContinuityCandidate({
    id: "candidate-1",
    payload: { text: "private source text" },
    canonicalStore: "working_context_items",
    entityId: "entity-1",
    sourceLineageId: "lineage-1",
    evidenceRefs: ["evidence-1"],
    ...overrides,
  });
}

describe("MAT-II continuity candidate transport", () => {
  it("requires stable provenance bindings without making the common layer a currentness authority", () => {
    const candidate = makeCandidate({ disposition: "STALE" });

    expect(candidate).toMatchObject({
      id: "candidate-1",
      canonicalStore: "working_context_items",
      entityId: "entity-1",
      sourceLineageId: "lineage-1",
      evidenceRefs: ["evidence-1"],
      disposition: "STALE",
    });
    expect(candidate.payload).toEqual({ text: "private source text" });
    expect(applyAuthoritativeInvalidations(candidate, { authoritativeLineageId: "lineage-1" }))
      .toMatchObject({ disposition: "STALE", payload: { text: "private source text" } });
  });

  it("recognizes a tombstoned entity as INELIGIBLE and removes its payload", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const { lineageId } = ensureAuthoritativeLineage(continuity, {
      nuclearSchemaVersion: 44,
      buildIdentity: "mat2-test",
    });
    continuity.prepare(
      `INSERT INTO forget_tombstones
         (tombstone_id, owner_id, lineage_id, status, created_at)
       VALUES (?, ?, ?, 'applied', ?)`,
    ).run("tombstone-1", "owner-1", lineageId, new Date().toISOString());
    continuity.prepare(
      `INSERT INTO forget_tombstone_targets
         (tombstone_id, entity_type, entity_uuid, action)
       VALUES (?, ?, ?, 'redact')`,
    ).run("tombstone-1", "working_context_items", "entity-1");

    const invalidated = applyAuthoritativeInvalidations(makeCandidate({ sourceLineageId: lineageId }), {
      continuity,
    });

    expect(invalidated.disposition).toBe("INELIGIBLE");
    expect(invalidated.payload).toBeUndefined();
    expect(invalidated.evidenceRefs).toEqual(["evidence-1"]);
  });

  it("fails closed on a continuity lineage mismatch", () => {
    expect(() => applyAuthoritativeInvalidations(makeCandidate(), {
      authoritativeLineageId: "different-lineage",
    })).toThrowError("continuity_lineage_mismatch");
  });

  it("does not turn budget omission into a forgetting or deletion operation", () => {
    const candidate = makeCandidate({ disposition: "OMITTED_FOR_BUDGET" });
    const invalidated = applyAuthoritativeInvalidations(candidate, {
      authoritativeLineageId: "lineage-1",
    });

    expect(invalidated.disposition).toBe("OMITTED_FOR_BUDGET");
    expect(invalidated.payload).toEqual({ text: "private source text" });
  });
});

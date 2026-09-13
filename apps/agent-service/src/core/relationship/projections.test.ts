import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "../memory/assertions.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import { listIdentity, recordIdentityEntry } from "../identity/store.js";
import {
  getCurrentSharedCulture,
  listHistoricalSharedCulture,
  recomputeSharedCulture,
  relationshipProjectionDiagnostics,
} from "./projections.js";

const OWNER = "c5-projection-owner";

function addAssertion(
  db: DatabaseSync,
  subjectFacet: "owner_model" | "ashley_side",
  text: string,
  classification = defaultUnclassifiedConversational(),
): number {
  return insertAssertion(db, {
    ownerId: OWNER,
    kind: "owner_interpretation",
    subjectFacet,
    lineageKind: subjectFacet === "owner_model" ? "owner_designated" : "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I1",
    claimText: text,
    sourceKind: "c5_projection_fixture",
    recordedAt: "2026-08-20T10:00:00.000Z",
    authorityFrom: "2026-08-20T10:00:00.000Z",
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: classification,
  });
}

describe("C5 shared-culture projections", () => {
  it("keeps source truth unchanged while observe and dark-apply projections vary only by mode provenance", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const ownerAssertion = addAssertion(db, "owner_model", "Doc enjoys modular synthesis.");
      const ashleyAssertion = addAssertion(db, "ashley_side", "Ashley enjoys modular synthesis.");
      const before = db.prepare(
        `SELECT id, termination_reason, authority_from, authority_to, claim_text
         FROM memory_assertions WHERE id IN (?, ?) ORDER BY id`,
      ).all(ownerAssertion, ashleyAssertion);

      const observed = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T12:00:00.000Z"),
        capabilityMode: "observe",
      });
      const darkApplied = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T13:00:00.000Z"),
        capabilityMode: "dark_apply",
      });

      expect(darkApplied.sourceBindings).toEqual(observed.sourceBindings);
      expect(darkApplied.provenance).toBe("live");
      expect(observed.provenance).toBe("shadow");
      expect(db.prepare(
        `SELECT id, termination_reason, authority_from, authority_to, claim_text
         FROM memory_assertions WHERE id IN (?, ?) ORDER BY id`,
      ).all(ownerAssertion, ashleyAssertion)).toEqual(before);
      expect(getCurrentSharedCulture(db, OWNER)?.sourceBindings).toEqual(observed.sourceBindings);
    } finally {
      db.close();
    }
  });

  it("keeps secret sources out and reports private Thought versus owner commitments policy separately", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      addAssertion(db, "owner_model", "Doc enjoys private signal design.");
      addAssertion(db, "ashley_side", "Ashley enjoys private signal design.", "secret");
      const projection = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T12:00:00.000Z"),
      });
      expect(projection.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(projection.sourceBindings.ashleyAssertionIds).toEqual([]);
      const diagnostics = relationshipProjectionDiagnostics(db, OWNER);
      expect(diagnostics.privateThoughtPolicy).toContain("never_public may enter authorized private Thought");
      expect(diagnostics.privateThoughtPolicy).toContain("secret is excluded");
      expect(diagnostics.commitmentsSurfacePolicy).toContain("hidden from /commitments");
    } finally {
      db.close();
    }
  });

  it("does not rewrite Ashley Identity when owner overlap is corrected", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const identityId = recordIdentityEntry(db, {
        ownerId: OWNER,
        layer: "stable",
        kind: "taste.music",
        text: "Ashley enjoys modular synthesis.",
        source: "manual",
      });
      const ownerAssertion = addAssertion(db, "owner_model", "Doc enjoys modular synthesis.");
      recomputeSharedCulture(db, OWNER, { at: new Date("2026-08-20T12:00:00.000Z") });
      const identityBefore = listIdentity(db, OWNER).map((entry) => ({
        id: entry.id,
        text: entry.text,
        revisedFrom: entry.revisedFrom,
      }));

      db.prepare(
        `UPDATE memory_assertions SET termination_reason = 'invalidated',
         authority_to = '2026-08-21T12:00:00.000Z' WHERE id = ?`,
      ).run(ownerAssertion);
      const current = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-21T12:00:00.000Z"),
      });
      expect(current.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(current.sourceBindings.ashleyIdentityEntryIds).toEqual([]);
      expect(listIdentity(db, OWNER).map((entry) => ({
        id: entry.id,
        text: entry.text,
        revisedFrom: entry.revisedFrom,
      }))).toEqual(identityBefore);
      expect(identityId).toBeGreaterThan(0);
      expect(listHistoricalSharedCulture(db, OWNER)).toHaveLength(1);
      expect(() => db.prepare(
        `UPDATE relationship_projections SET content_binding = 'tampered'
         WHERE kind = 'historical_as_of' AND owner_id = ?`,
      ).run(OWNER)).toThrow("relationship_projection_historical_immutable");
    } finally {
      db.close();
    }
  });
});

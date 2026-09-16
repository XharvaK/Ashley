import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { getMemoryAssertion, retractMemoryAssertion, upsertMemoryAssertion } from "../memory/assertions.js";
import { appendMemorySupport, listMemorySupports } from "../memory/supports.js";
import { buildLearnedSelfSlice, validateLearnedSelfEntry } from "./learned-self.js";

const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };

describe("v0.2.1 LearnedSelf Option B", () => {
  it("rejects world claims and has no candidate writer", () => {
    expect(() => validateLearnedSelfEntry({ memoryKind: "owner_world_claim", statement: "HY3 is an LLM" })).toThrow("learned_self_world_claim_forbidden");
    expect(validateLearnedSelfEntry({ memoryKind: "learned_self_evidence", statement: "I favor careful explanations." })).toBe(true);
  });

  it("withdraws live learned-self evidence without Thought adoption from the projection", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, { assertionKey: "self:live", statement: "I favor careful explanations.", memoryKind: "learned_self_evidence", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      upsertMemoryAssertion(db, { assertionKey: "self:old", statement: "Old self observation.", memoryKind: "learned_self_evidence", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: null, live: false });
      upsertMemoryAssertion(db, { assertionKey: "world:live", statement: "HY3 is an LLM.", memoryKind: "owner_world_claim", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      expect(buildLearnedSelfSlice(db)).toEqual({ dispositions: [], interests: [] });
      expect(getMemoryAssertion(db, "self:live")).toMatchObject({ live: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM admission_log").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("carries the retrieval support mapping without scores or repetition counters", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, {
        assertionKey: "self:supported",
        statement: "disposition: prefers careful explanations.",
        memoryKind: "learned_self_evidence",
        dimensions,
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      const adoptedNomination = {
        nominationId: "episode:one",
        cycleId: "cycle:supported",
        generation: 1,
        assertionKey: "self:supported",
        statement: "disposition: prefers careful explanations.",
        memoryKind: "learned_self_evidence" as const,
        dimensions,
        dataClassification: "never_public" as const,
        supersedesAssertionKey: null,
        concernId: null,
        sourceRefs: [],
      };
      db.prepare(
        `INSERT INTO durable_nominations
           (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
            dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted, source_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        adoptedNomination.nominationId,
        adoptedNomination.cycleId,
        adoptedNomination.generation,
        adoptedNomination.assertionKey,
        adoptedNomination.statement,
        adoptedNomination.memoryKind,
        JSON.stringify(adoptedNomination.dimensions),
        adoptedNomination.dataClassification,
        adoptedNomination.supersedesAssertionKey,
        adoptedNomination.concernId,
        JSON.stringify(adoptedNomination.sourceRefs),
      );
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run("settlement:one", adoptedNomination.cycleId, adoptedNomination.generation, JSON.stringify({ durableNominations: [adoptedNomination] }));
      const supportBase = {
        assertionKey: "self:supported",
        source: "owner_utterance" as const,
        provenance: "native" as const,
        sourceArchitectureEpoch: "v0.2.1" as const,
        sourceRef: "episode:one",
        settlementId: "settlement:one",
        evidenceLineageId: "lineage:one",
        observationId: null,
        receiptId: null,
        dimensions,
        dataClassification: "never_public" as const,
      };
      appendMemorySupport(db, { ...supportBase, supportId: "support:one", createdAtMs: 1 });
      appendMemorySupport(db, { ...supportBase, supportId: "support:two", sourceRef: null, createdAtMs: 2 });

      const expected = listMemorySupports(db, "self:supported")
        .flatMap((support) => support.sourceRef == null ? [] : [support.sourceRef]);
      const slice = buildLearnedSelfSlice(db);

      expect(expected).toEqual(["episode:one"]);
      expect(slice.supportRefs).toEqual(expected);
      expect(slice).not.toHaveProperty("score");
      expect(slice).not.toHaveProperty("count");
      expect(slice).not.toHaveProperty("threshold");
      expect(slice.broadOrientation).toMatchObject({ supportRefs: expected });
    } finally {
      db.close();
    }
  });

  it("keeps a bounded interpersonal interpretation revisable and attributable", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, {
        assertionKey: "interpretation:person:one",
        statement: "The person may need more time.",
        memoryKind: "ashley_interpretation",
        dimensions: {
          source: "ashley_interpretation",
          status: "interpreted",
          time: "current",
          reliability: "inferred",
        },
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        subject: ["person:one"],
      });
      upsertMemoryAssertion(db, {
        assertionKey: "interpretation:person:two",
        statement: "The person has now said they need more time.",
        memoryKind: "ashley_interpretation",
        dimensions: {
          source: "ashley_interpretation",
          status: "unverified",
          time: "current",
          reliability: "fallible_observation",
        },
        dataClassification: "never_public",
        lineageParentKey: "interpretation:person:one",
        admittedGeneration: 2,
        live: true,
        subject: ["person:one"],
      });
      expect(retractMemoryAssertion(db, "interpretation:person:one")).toBe(true);

      expect(getMemoryAssertion(db, "interpretation:person:one")).toMatchObject({
        live: false,
        statement: "[redacted]",
        subject: ["person:one"],
      });
      expect(getMemoryAssertion(db, "interpretation:person:two")).toMatchObject({
        live: true,
        lineageParentKey: "interpretation:person:one",
        subject: ["person:one"],
        dimensions: { status: "unverified", reliability: "fallible_observation" },
      });
    } finally {
      db.close();
    }
  });
});

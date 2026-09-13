import { describe, expect, it } from "vitest";
import {
  buildAllocationCoverageManifest,
  COVERAGE_DISPOSITIONS,
  buildCoverageManifest,
  classifyCoverage,
  groundingStatusFor,
  type AllocationCoverageCandidate,
  type CoverageDisposition,
} from "../coverage-manifest.js";
import { createContinuityCandidate } from "../continuity-candidate.js";

describe("MAT-II coverage manifest", () => {
  it("keeps all eight dispositions distinct and reachable", () => {
    const dispositions = COVERAGE_DISPOSITIONS.map((disposition) =>
      classifyCoverage({ domain: disposition, disposition }),
    );

    expect(new Set(dispositions).size).toBe(8);
    expect(dispositions).toEqual([
      "INCLUDED",
      "OMITTED_FOR_BUDGET",
      "EMPTY",
      "UNREACHABLE",
      "INELIGIBLE",
      "STALE",
      "DEFERRED",
      "POINTER_ONLY",
    ] satisfies CoverageDisposition[]);
  });

  it("distinguishes zero source rows from source rows with zero eligible rows", () => {
    expect(classifyCoverage({
      domain: "working_context",
      querySucceeded: true,
      sourceRecordCount: 0,
      eligibleRecordCount: 0,
    })).toBe("EMPTY");
    expect(classifyCoverage({
      domain: "working_context",
      querySucceeded: true,
      sourceRecordCount: 3,
      eligibleRecordCount: 0,
    })).toBe("INELIGIBLE");
  });

  it("keeps grounding absence, infrastructure, reachability, and conflict distinct", () => {
    expect(groundingStatusFor({ sourceRecordCount: 0, eligibleRecordCount: 0 })).toBe("EMPTY");
    expect(groundingStatusFor({ infrastructureState: "unknown" })).toBe("UNKNOWN");
    expect(groundingStatusFor({ infrastructureState: "unavailable" })).toBe("UNAVAILABLE");
    expect(groundingStatusFor({ queryStatus: "failed" })).toBe("UNREACHABLE");
    expect(groundingStatusFor({ conflict: true, sourceRecordCount: 1, eligibleRecordCount: 0 }))
      .toBe("UNRESOLVED_CONFLICT");
    expect(groundingStatusFor({ sourceRecordCount: 1, eligibleRecordCount: 1 })).toBe("SUBSTANTIVE");
  });

  it("does not conflate dormant or stale rows with an empty store", () => {
    expect(classifyCoverage({
      domain: "working_context",
      querySucceeded: true,
      sourceRecordCount: 2,
      eligibleRecordCount: 0,
      ineligibleRecordCount: 2,
    })).toBe("INELIGIBLE");
    expect(classifyCoverage({
      domain: "working_context",
      querySucceeded: true,
      sourceRecordCount: 2,
      eligibleRecordCount: 0,
      staleRecordCount: 2,
    })).toBe("STALE");
  });

  it("fails closed for required query failures and fails soft for optional domains", () => {
    expect(() => classifyCoverage({
      domain: "identity",
      querySucceeded: false,
      required: true,
    })).toThrowError("coverage_required_unreachable");
    expect(classifyCoverage({
      domain: "concerns",
      querySucceeded: false,
      required: false,
    })).toBe("UNREACHABLE");
  });

  it("records counts and every disposition in a structured domain report", () => {
    const manifest = buildCoverageManifest([
      {
        domain: "identity",
        disposition: "INCLUDED",
        sourceRecordCount: 1,
        eligibleRecordCount: 1,
        candidateIds: ["identity-1"],
      },
      {
        domain: "conversation",
        disposition: "OMITTED_FOR_BUDGET",
        sourceRecordCount: 2,
        eligibleRecordCount: 2,
        candidateIds: ["conversation-1", "conversation-2"],
      },
      {
        domain: "curiosity",
        querySucceeded: true,
        sourceRecordCount: 0,
        eligibleRecordCount: 0,
      },
    ]);

    expect(manifest.version).toBe(1);
    expect(manifest.domains).toHaveLength(3);
    expect(manifest.domains[0]).toMatchObject({
      domain: "identity",
      disposition: "INCLUDED",
      source_record_count: 1,
      eligible_record_count: 1,
      candidate_ids: ["identity-1"],
      grounding_status: "SUBSTANTIVE",
    });
    expect(manifest.dispositionCounts).toMatchObject({
      INCLUDED: 1,
      OMITTED_FOR_BUDGET: 1,
      EMPTY: 1,
    });
  });

  it("keeps POINTER_ONLY as an explicit bounded pointer state", () => {
    const manifest = buildCoverageManifest([{
      domain: "concerns",
      pointerOnly: true,
      querySucceeded: true,
      sourceRecordCount: 4,
      eligibleRecordCount: 2,
      candidateIds: ["concern-pointer"],
    }]);

    expect(manifest.domains[0]).toMatchObject({
      disposition: "POINTER_ONLY",
      source_record_count: 4,
      eligible_record_count: 2,
    });
  });

  it("preserves domain-owned dispositions when allocation includes or omits a candidate", () => {
    const stale = createContinuityCandidate({
      id: "stale-1",
      payload: { id: "stale-1" },
      canonicalStore: "domain-store",
      entityId: "stale-1",
      sourceLineageId: "lineage-1",
      disposition: "STALE",
    });
    const pointer = createContinuityCandidate({
      id: "pointer-1",
      payload: { id: "pointer-1" },
      canonicalStore: "domain-store",
      entityId: "pointer-1",
      sourceLineageId: "lineage-1",
      disposition: "POINTER_ONLY",
    });

    const manifest = buildAllocationCoverageManifest({
      included: [{
        id: stale.id,
        section: "domain_pointers",
        continuityCandidate: stale,
      } satisfies AllocationCoverageCandidate],
      omitted: [{
        id: pointer.id,
        section: "domain_pointers",
        continuityCandidate: pointer,
      } satisfies AllocationCoverageCandidate],
    });

    expect(manifest.domains.map((domain) => domain.disposition)).toEqual([
      "STALE",
      "POINTER_ONLY",
    ]);
  });
});

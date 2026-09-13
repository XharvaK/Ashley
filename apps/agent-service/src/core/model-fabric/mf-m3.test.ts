import { describe, expect, it } from "vitest";
import {
  assertIndependentJudgeGroups,
  catalogEntryFromDiscovery,
  createQualificationBinding,
  loadFabricCatalog,
  loadTargetPortfolio,
  transitionCatalogLifecycle,
  type QualificationResultRecord,
} from "./catalog.js";
import { capabilityProfileFor, currentPortfolio } from "./index.js";

describe("MF-M3 catalog and qualification records", () => {
  it("loads independence groups, seats, and coupling data", () => {
    const catalog = loadFabricCatalog();
    expect(catalog.independenceGroups.openai_gpt_oss).toContain("openai/gpt-oss-20b");
    expect(catalog.independenceGroups.nvidia_nemotron).toContain(
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    );
    expect(catalog.seats.find((seat) => seat.seat === "evaluation_independent_judge"))
      .toMatchObject({ userVisibleProductionRole: false });
    expect(catalog.couplings.qc_groq_gpt_oss_20b).toContain("utility_bulk compatibility");
  });

  it("turns discovery into unqualified data and never mints owner approval", () => {
    const entry = catalogEntryFromDiscovery({
      occupantId: "mfo_discovered_example",
      provider: "groq",
      configuredModelId: "openai/gpt-oss-120b",
      independenceGroup: "openai_gpt_oss",
      discoveredBy: "owner_import",
    });
    expect(entry.lifecycle).toBe("unqualified");
    expect(entry.ownerApprovalRefId).toBeNull();
    expect(() =>
      transitionCatalogLifecycle(entry, "owner_approved", {
        ownerApprovalRefId: null,
      }),
    ).toThrow("owner_approval_required");
  });

  it("enforces lifecycle ordering and keeps recovery separate from qualification", () => {
    const entry = catalogEntryFromDiscovery({
      occupantId: "mfo_lifecycle_example",
      provider: "groq",
      configuredModelId: "openai/gpt-oss-120b",
      independenceGroup: "openai_gpt_oss",
      discoveredBy: "operator_import",
    });
    const qualifying = transitionCatalogLifecycle(entry, "qualifying");
    expect(qualifying.lifecycle).toBe("qualifying");
    expect(() => transitionCatalogLifecycle(entry, "qualified")).toThrow(
      "invalid_catalog_lifecycle_transition",
    );
    const degraded = transitionCatalogLifecycle(
      transitionCatalogLifecycle(qualifying, "qualified"),
      "degraded",
    );
    expect(degraded.lifecycle).toBe("degraded");
    expect(() => transitionCatalogLifecycle(degraded, "qualified")).toThrow(
      "recovery_does_not_requalify",
    );
  });

  it("rejects compatibility rows and aggregate reports as qualification bindings", () => {
    const row = currentPortfolio().rows.find(
      (candidate) => candidate.policyRowId === "mfr_thought_interactive_compat_v1",
    )!;
    const occupant = row.occupants[0]!;
    const profile = capabilityProfileFor(occupant.provider, occupant.configuredModelId);
    const compatibilityResult = {
      schema: "ashley.evaluation.qualification_result.v1",
      qualificationResultId: "qres_compatibility_forbidden",
      status: "PASS",
      policyRowId: row.policyRowId,
      occupantId: occupant.occupantId,
      subject: {
        logicalRole: row.logicalRole,
        seat: row.seat,
        materialInferenceFingerprint: "sha256:compatibility",
      },
      profileBinding: profile,
      identityContinuityEpoch: null,
      recommendation: "owner_review",
      limitations: [],
      invalidated: false,
      invalidatedBy: null,
    } satisfies QualificationResultRecord;
    expect(() =>
      createQualificationBinding({
        qualificationResult: compatibilityResult,
        policyRow: row,
        occupant,
        profile,
      } as unknown as Parameters<typeof createQualificationBinding>[0]),
    ).toThrow("existing_compatibility_not_qualification");
    expect(() =>
      createQualificationBinding({
        qualificationResult: {
          ...compatibilityResult,
          schema: "ashley.evaluation.aggregate_report.v1",
        },
        policyRow: row,
        occupant,
        profile,
      } as unknown as Parameters<typeof createQualificationBinding>[0]),
    ).toThrow("qualification_result_schema_invalid");
  });

  it("binds only a PASS result with exact profile and inference identity", () => {
    const target = loadTargetPortfolio();
    const row = target.rows.find(
      (candidate) => candidate.policyRowId === "mfr_thought_interactive_target_v1",
    )!;
    const occupant = row.occupants[0]!;
    const profile = capabilityProfileFor(occupant.provider, occupant.configuredModelId);
    const result: QualificationResultRecord = {
      schema: "ashley.evaluation.qualification_result.v1",
      qualificationResultId: "qres_target_thought_example",
      status: "PASS",
      policyRowId: row.policyRowId,
      occupantId: occupant.occupantId,
      subject: {
        logicalRole: row.logicalRole,
        seat: row.seat,
        materialInferenceFingerprint: "sha256:material-example",
      },
      profileBinding: {
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
        profileFingerprint: profile.profileFingerprint,
        provider: profile.provider,
        configuredModelId: profile.configuredModelId,
      },
      identityContinuityEpoch: null,
      recommendation: "owner_review",
      limitations: [],
      invalidated: false,
      invalidatedBy: null,
    };
    const binding = createQualificationBinding({
      qualificationResult: result,
      policyRow: row,
      occupant,
      profile,
      materialInferenceFingerprint: "sha256:material-example",
    });
    expect(binding.qualificationResultId).toBe(result.qualificationResultId);
    expect(binding.profileFingerprint).toBe(profile.profileFingerprint);
    expect(() =>
      createQualificationBinding({
        qualificationResult: { ...result, invalidated: true },
        policyRow: row,
        occupant,
        profile,
        materialInferenceFingerprint: "sha256:material-example",
      }),
    ).toThrow("qualification_result_invalidated");
  });

  it("refuses same-independence-group judges and keeps unordered candidates unordered", () => {
    expect(assertIndependentJudgeGroups("openai_gpt_oss", "openai_gpt_oss")).toBe(false);
    expect(assertIndependentJudgeGroups("openai_gpt_oss", "nvidia_nemotron")).toBe(true);
    const curiosity = loadTargetPortfolio().rows.find(
      (row) => row.policyRowId === "mfr_curiosity_consolidation_target_v1",
    )!;
    expect(curiosity.unorderedCandidates.length).toBeGreaterThan(0);
    expect(curiosity.unorderedCandidates.every((candidate) => candidate.ordinal === undefined)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { ModelFabricOccupant } from "./portfolio.js";
import {
  approvedChainFor,
  createHealthRegistry,
  healthPredicates,
  walkApprovedChain,
  type ApprovedChainEntry,
} from "./health.js";

const policyRowId = "mfr_target_thought_interactive_v1";

function occupant(
  occupantId: string,
  ordinal: number,
  configuredModelId = "openai/gpt-oss-120b",
): ModelFabricOccupant {
  return {
    occupantId,
    ordinal,
    provider: ordinal === 1 ? "groq" : "nim",
    backend: ordinal === 1 ? "groq" : "nim",
    configuredModelId,
    independenceGroup: "openai_gpt_oss",
    reasoningPolicy: "high",
    effectiveReasoning: "high",
    privacyEligibility: ["owner_private"],
    admissionBasis: { kind: "qualification_owner_approved" },
  };
}

function qualifiedEntry(
  occupantId: string,
  ordinal: number,
  overrides: Partial<ApprovedChainEntry> = {},
): ApprovedChainEntry {
  const candidate = occupant(occupantId, ordinal);
  return {
    occupant: candidate,
    qualification: {
      schema: "ashley.evaluation.qualification_result.v1",
      qualificationResultId: `qres_${occupantId}`,
      status: "PASS",
      policyRowId,
      occupantId,
      invalidated: false,
    },
    ownerApproval: {
      ownerApprovalRefId: `approval_${occupantId}`,
      decision: "approve",
      revoked: false,
      policyRowId,
      occupantId,
      qualificationResultId: `qres_${occupantId}`,
    },
    catalogLifecycle: "owner_approved",
    ...overrides,
  };
}

describe("MF-M5 approved-chain health", () => {
  it("excludes unqualified, invalidated, and revoked occupants from the pool", () => {
    const valid = qualifiedEntry("mfo_valid", 1);
    const unqualified = qualifiedEntry("mfo_unqualified", 2, {
      qualification: null,
    });
    const invalidated = qualifiedEntry("mfo_invalidated", 3, {
      qualification: {
        ...valid.qualification!,
        qualificationResultId: "qres_mfo_invalidated",
        occupantId: "mfo_invalidated",
        invalidated: true,
      },
    });
    const revoked = qualifiedEntry("mfo_revoked", 4, {
      ownerApproval: {
        ...valid.ownerApproval!,
        ownerApprovalRefId: "approval_mfo_revoked",
        occupantId: "mfo_revoked",
        qualificationResultId: "qres_mfo_revoked",
        revoked: true,
      },
    });

    expect(
      approvedChainFor({
        policyRowId,
        candidates: [valid, unqualified, invalidated, revoked],
      }).map((entry) => entry.occupant.occupantId),
    ).toEqual(["mfo_valid"]);
  });

  it("walks to the next approved occupant after a primary health failure", () => {
    let nowMs = 1000;
    const registry = createHealthRegistry(() => nowMs);
    const primary = qualifiedEntry("mfo_primary", 1);
    const secondary = qualifiedEntry("mfo_secondary", 2);
    registry.recordFailure(primary.occupant.occupantId, { cooldownMs: 5000 });

    const result = walkApprovedChain({
      policyRowId,
      candidates: [primary, secondary],
      registry,
      nowMs,
    });

    expect(result.selected.occupant.occupantId).toBe("mfo_secondary");
    expect(result.predicates.mfo_primary.ready).toBe(false);
    expect(result.predicates.mfo_primary.degraded).toBe(true);
    expect(result.predicates.mfo_secondary.ready).toBe(true);
    expect(primary.occupant.occupantId).toBe("mfo_primary");
    nowMs += 10_000;
    expect(registry.healthFor(primary.occupant.occupantId).ready).toBe(false);
  });

  it("fails closed when the approved chain has no ready secondary", () => {
    const registry = createHealthRegistry(() => 1000);
    const primary = qualifiedEntry("mfo_primary_only", 1);
    registry.recordFailure(primary.occupant.occupantId, { cooldownMs: 5000 });

    expect(() =>
      walkApprovedChain({
        policyRowId,
        candidates: [primary],
        registry,
        nowMs: 1000,
      }),
    ).toThrow("no_approved_occupant_ready");
  });

  it("never adds a cheaper unqualified occupant under quota pressure", () => {
    const registry = createHealthRegistry(() => 1000);
    const primary = qualifiedEntry("mfo_approved_primary", 1);
    const cheaperButUnqualified = qualifiedEntry(
      "mfo_cheaper_unqualified",
      2,
      {
        qualification: null,
      },
    );
    registry.recordFailure(primary.occupant.occupantId, { cooldownMs: 5000 });

    expect(() =>
      walkApprovedChain({
        policyRowId,
        candidates: [primary, cheaperButUnqualified],
        registry,
        selectionReason: "quota_exhausted",
        nowMs: 1000,
      }),
    ).toThrow("no_approved_occupant_ready");
  });

  it("clears process-local cooldown after a new registry is created", () => {
    const primary = qualifiedEntry("mfo_restart_primary", 1);
    const failedRegistry = createHealthRegistry(() => 1000);
    failedRegistry.recordFailure(primary.occupant.occupantId, { cooldownMs: 60_000 });
    expect(failedRegistry.healthFor(primary.occupant.occupantId).ready).toBe(false);

    const restartedRegistry = createHealthRegistry(() => 1000);
    const result = walkApprovedChain({
      policyRowId,
      candidates: [primary],
      registry: restartedRegistry,
      nowMs: 1000,
    });
    expect(result.selected.occupant.occupantId).toBe("mfo_restart_primary");
    expect(result.predicates.mfo_restart_primary.ready).toBe(true);
  });

  it("keeps configured, qualified, approval, active, and degraded predicates distinct", () => {
    const predicates = healthPredicates({
      configured: true,
      available: false,
      qualified: true,
      ownerApproved: false,
      active: true,
      degraded: true,
      cooldownUntilMs: 2000,
      nowMs: 1000,
    });
    expect(predicates).toMatchObject({
      configured: true,
      available: false,
      qualified: true,
      ownerApproved: false,
      active: true,
      degraded: true,
      ready: false,
      cooldownUntilMs: 2000,
    });
  });

  it("requires the supplied chain to be ordered and does not sort it", () => {
    const first = qualifiedEntry("mfo_second_ordinal", 2);
    const second = qualifiedEntry("mfo_first_ordinal", 1);
    expect(() =>
      walkApprovedChain({
        policyRowId,
        candidates: [first, second],
        registry: createHealthRegistry(() => 1000),
        nowMs: 1000,
      }),
    ).toThrow("approved_chain_not_ordered");
  });
});

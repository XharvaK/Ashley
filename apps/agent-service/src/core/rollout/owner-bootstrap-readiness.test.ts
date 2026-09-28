import { describe, expect, it } from "vitest";
import type { CapabilityName } from "./capabilities.js";
import {
  ownerBootstrapReadinessFor,
  type OwnerBootstrapAvailability,
} from "./owner-bootstrap-readiness.js";

const available: OwnerBootstrapAvailability = {
  commandCode: true,
  webFetch: true,
  webSearch: true,
  projectInspection: true,
  projectExperimentation: true,
  candidateVerification: true,
  candidateAuthorship: true,
  boundedOperation: true,
  patchExport: true,
  ownerGrantedCapabilities: new Set(),
};

describe("owner bootstrap readiness", () => {
  it("allows independent project capabilities when their host gates are ready", () => {
    expect(ownerBootstrapReadinessFor("project_inspection", available)).toEqual({ ready: true });
    expect(ownerBootstrapReadinessFor("project_experimentation", available)).toEqual({ ready: true });
    expect(ownerBootstrapReadinessFor("candidate_verification", available)).toEqual({ ready: true });
    expect(ownerBootstrapReadinessFor("candidate_authorship", available)).toEqual({ ready: true });
    expect(ownerBootstrapReadinessFor("bounded_operation", available)).toEqual({ ready: true });
    expect(ownerBootstrapReadinessFor("patch_export", available)).toEqual({ ready: true });
  });

  it("fails closed when an independent project host gate is unavailable", () => {
    expect(ownerBootstrapReadinessFor("project_inspection", {
      ...available,
      projectInspection: false,
    })).toEqual({ ready: false, reason: "dependencies_unavailable" });
  });

  it("keeps provider readiness separate from owner authorization", () => {
    expect(ownerBootstrapReadinessFor("vision", {
      ...available,
      commandCode: false,
    })).toEqual({ ready: false, reason: "provider_unavailable" });
    expect(ownerBootstrapReadinessFor("web_search", {
      ...available,
      webSearch: false,
    })).toEqual({ ready: false, reason: "provider_unavailable" });
  });

  it("does not turn owner authorization into memory or third-party authority", () => {
    const separatelyGated: CapabilityName[] = [
      "memory_evidence",
      "context_budget",
      "learned_autonomy",
      "cognitive_graduation",
      "relational_graduation",
      "external_observe",
      "external_prepare",
      "external_private",
      "external_public",
    ];
    for (const capability of separatelyGated) {
      expect(ownerBootstrapReadinessFor(capability, available)).toEqual({
        ready: false,
        reason: "owner_grant_required",
      });
    }
  });

  it("recognizes only explicitly granted protected capabilities", () => {
    const granted = Object.assign({}, available, {
      ownerGrantedCapabilities: new Set<CapabilityName>([
        "external_observe",
        "external_prepare",
        "external_private",
        "external_public",
        "memory_evidence",
        "context_budget",
        "learned_autonomy",
        "cognitive_graduation",
        "relational_graduation",
      ]),
    }) as OwnerBootstrapAvailability & {
      ownerGrantedCapabilities: ReadonlySet<CapabilityName>;
    };

    for (const capability of granted.ownerGrantedCapabilities) {
      expect(ownerBootstrapReadinessFor(capability, granted)).toEqual({ ready: true });
    }

    const externalOnly = Object.assign({}, available, {
      ownerGrantedCapabilities: new Set<CapabilityName>([
        "external_observe",
        "external_prepare",
        "external_private",
        "external_public",
      ]),
    }) as OwnerBootstrapAvailability & {
      ownerGrantedCapabilities: ReadonlySet<CapabilityName>;
    };
    expect(ownerBootstrapReadinessFor("memory_evidence", externalOnly)).toEqual({
      ready: false,
      reason: "owner_grant_required",
    });
  });
});

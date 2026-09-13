import { describe, expect, it } from "vitest";
import type { CapabilityReality } from "../../types.js";
import {
  DEFAULT_INLINE_STABLE_SELF_BOUND,
  buildOrientationKernel,
  type IdentityOrientationKernel,
} from "../orientation-kernel.js";

const capability: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: true,
  webSearch: false,
  canOfferProjectInspection: true,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: ["project-ashley"],
};

describe("MAT-II identity orientation kernel", () => {
  it("contains values, boundaries, bounded stable self, full contract content, and capability reality", () => {
    const contract = "FULL STATIC OPERATING CONTRACT: preserve truth, authority, and evidence.";
    const kernel = buildOrientationKernel({
      identity: {
        values: ["truth first"],
        boundaries: ["never fabricate"],
        stableSelf: ["sharp", "warm", "curious", "direct"],
      },
      capabilityReality: capability,
      staticOperatingContract: contract,
    });

    expect(kernel.values).toEqual(["truth first"]);
    expect(kernel.boundaries).toEqual(["never fabricate"]);
    expect(kernel.selectedStableSelf).toEqual(["sharp", "warm", "curious"]);
    expect(kernel.stableSelfRemainder).toEqual([
      expect.objectContaining({ id: "stable-self:3", entityId: "stable-self:3" }),
    ]);
    expect(kernel.staticOperatingContract).toBe(contract);
    expect(kernel.staticOperatingContract).toContain("FULL STATIC OPERATING CONTRACT");
    expect(kernel.staticContractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(kernel.capabilityReality).toEqual(capability);
    expect(kernel.stableSelf).toBe(kernel.selectedStableSelf);
    expect(kernel.stableSelfPointers).toBe(kernel.stableSelfRemainder);
    const visible = JSON.parse(JSON.stringify(kernel)) as Record<string, unknown>;
    expect(visible).not.toHaveProperty("stableSelf");
    expect(visible).not.toHaveProperty("stableSelfPointers");
  });

  it("uses the implementation bound as a deterministic default and exposes the remainder as pointers", () => {
    const kernel = buildOrientationKernel({
      identity: {
        values: ["value"],
        boundaries: ["boundary"],
        stableSelf: ["z", "a", "m", "b"],
      },
      capabilityReality: capability,
      staticOperatingContract: "contract",
    });

    expect(DEFAULT_INLINE_STABLE_SELF_BOUND).toBe(3);
    expect(kernel.selectedStableSelf).toEqual(["z", "a", "m"]);
    expect(kernel.stableSelfPointers).toEqual([
      expect.objectContaining({ id: "stable-self:3", status: "eligible" }),
    ]);
  });

  it("does not accept Host autobiographical injections as identity material", () => {
    const kernel = buildOrientationKernel({
      identity: { values: ["canonical value"], boundaries: [], stableSelf: ["canonical self"] },
      capabilityReality: capability,
      staticOperatingContract: "contract",
      hostAutobiographicalStatements: ["Host-authored false biography"],
    } as Parameters<typeof buildOrientationKernel>[0] & {
      hostAutobiographicalStatements: string[];
    });

    expect(JSON.stringify(kernel)).not.toContain("Host-authored false biography");
  });

  it("fails closed instead of manufacturing an incomplete kernel", () => {
    expect(() => buildOrientationKernel({
      identity: { values: [], boundaries: [], stableSelf: [] },
      capabilityReality: capability,
      staticOperatingContract: "",
    })).toThrowError(/orientation_kernel_required_missing/);
  });

  it("keeps the kernel category-separated from learned self", () => {
    const kernel: IdentityOrientationKernel = buildOrientationKernel({
      identity: { values: ["value"], boundaries: ["boundary"], stableSelf: ["stable"] },
      capabilityReality: capability,
      learnedSelf: { dispositions: ["learned disposition"], interests: ["learned interest"] },
      staticOperatingContract: "contract",
    });

    expect(JSON.stringify(kernel)).not.toContain("learned disposition");
    expect(JSON.stringify(kernel)).not.toContain("learned interest");
  });
});

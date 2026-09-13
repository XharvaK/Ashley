import { describe, expect, it } from "vitest";
import { resolveQualificationBuildIdentity } from "./capabilities.js";

const CANDIDATE = "a".repeat(40);
const STALE_PRODUCTION_RELEASE = "b".repeat(40);

describe("isolated qualification build identity", () => {
  it("rejects a stale production release identity before dispatch", () => {
    expect(() => resolveQualificationBuildIdentity({
      expectedCandidateSha: CANDIDATE,
      actualCheckoutIdentity: CANDIDATE,
      qualificationReleaseIdentity: STALE_PRODUCTION_RELEASE,
    })).toThrow("qualification_release_identity_mismatch");
  });

  it("accepts the exact isolated checkout identity", () => {
    expect(resolveQualificationBuildIdentity({
      expectedCandidateSha: CANDIDATE,
      actualCheckoutIdentity: CANDIDATE,
      qualificationReleaseIdentity: CANDIDATE,
    })).toBe(CANDIDATE);
  });

  it("does not require credentials to provide candidate identity", () => {
    expect(resolveQualificationBuildIdentity({
      expectedCandidateSha: CANDIDATE,
      actualCheckoutIdentity: CANDIDATE,
      qualificationReleaseIdentity: "",
    })).toBe(CANDIDATE);
  });

  it("rejects a checkout that is not the frozen candidate", () => {
    expect(() => resolveQualificationBuildIdentity({
      expectedCandidateSha: CANDIDATE,
      actualCheckoutIdentity: STALE_PRODUCTION_RELEASE,
      qualificationReleaseIdentity: CANDIDATE,
    })).toThrow("qualification_checkout_identity_mismatch");
  });
});

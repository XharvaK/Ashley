import { describe, expect, it } from "vitest";
import {
  deriveOperationalTruth,
  renderOperationalTruth,
} from "./operational-truth.js";

describe("deriveOperationalTruth", () => {
  it("derives verified_success with locked=true when roundtrip effect evidence is verified", () => {
    const truth = deriveOperationalTruth({
      state: "succeeded",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
      effectEvidence: {
        verified: true,
        workspaceId: "ws-1",
        relativePath: "test.txt",
        bytesWritten: 10,
        contentHash: "hash-123",
        readMatches: true,
        deleted: true,
        verifiedAbsent: true,
        completedAtMs: Date.now(),
      },
    });

    expect(truth.state).toBe("verified_success");
    expect(truth.locked).toBe(true);
    expect(truth.semanticOutput).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
    expect(renderOperationalTruth(truth)).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
  });

  it("fails closed when succeeded state has unverified or missing effect evidence", () => {
    const truth = deriveOperationalTruth({
      state: "succeeded",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
      effectEvidence: {
        verified: true,
        workspaceId: "ws-1",
        relativePath: "test.txt",
        bytesWritten: 10,
        contentHash: "hash-123",
        readMatches: false, // unverified!
        deleted: true,
        verifiedAbsent: true,
        completedAtMs: Date.now(),
      },
    });

    expect(truth.state).toBe("none");
    expect(truth.locked).toBe(false);
  });

  it("derives locked failed truth with exact error code", () => {
    const truth = deriveOperationalTruth({
      state: "failed",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
      error: "internal_error",
    });

    expect(truth.state).toBe("failed");
    expect(truth.locked).toBe(true);
    expect(truth.error).toBe("internal_error");
    expect(truth.semanticOutput).toBe(
      "the sandbox check was attempted but failed: internal_error.",
    );
  });

  it("derives locked outcome_unknown truth", () => {
    const truth = deriveOperationalTruth({
      state: "outcome_unknown",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
    });

    expect(truth.state).toBe("outcome_unknown");
    expect(truth.locked).toBe(true);
    expect(truth.semanticOutput).toBe(
      "the sandbox check outcome is unknown after restart.",
    );
  });

  it("derives locked refusal truth when refusalReason is present", () => {
    const truth = deriveOperationalTruth({
      state: "none",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
      refusalReason: "security_boundary_check_failed",
    });

    expect(truth.locked).toBe(true);
    expect(truth.refusalReason).toBe("security_boundary_check_failed");
    expect(truth.semanticOutput).toContain("security_boundary_check_failed");
  });

  it("derives non-locked admitted state", () => {
    const truth = deriveOperationalTruth({
      state: "admitted",
      taskId: "v2-m1-123",
      profile: "sandbox_workspace_file_roundtrip",
    });

    expect(truth.state).toBe("admitted");
    expect(truth.locked).toBe(false);
  });

  it("derives non-locked none state when license is undefined", () => {
    const truth = deriveOperationalTruth(undefined);
    expect(truth.state).toBe("none");
    expect(truth.locked).toBe(false);
    expect(truth.semanticOutput).toBeUndefined();
  });
});

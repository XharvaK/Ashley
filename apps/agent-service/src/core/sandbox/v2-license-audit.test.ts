import { describe, expect, it, vi } from "vitest";
import {
  formatSandboxV2LicenseAudit,
  emitSandboxV2LicenseAudit,
} from "./v2-license-audit.js";

describe("v2-license-audit", () => {
  it("formats structured diagnostic record for verified succeeded license", () => {
    const record = formatSandboxV2LicenseAudit({
      state: "succeeded",
      taskId: "v2-m1-12345",
      profile: "sandbox_workspace_file_roundtrip",
      sourceMessageEntityUuid: "uuid-abc-123",
      effectEvidence: {
        verified: true,
        workspaceId: "ws-1",
        relativePath: "test.txt",
        bytesWritten: 16,
        contentHash: "hash-999",
        readMatches: true,
        deleted: true,
        verifiedAbsent: true,
        completedAtMs: 1234567890,
      },
    });

    expect(record).toEqual({
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: "uuid-abc-123",
      state: "succeeded",
      taskId: "v2-m1-12345",
      profile: "sandbox_workspace_file_roundtrip",
      verified: true,
      error: null,
      refusalReason: null,
      effect: {
        readMatches: true,
        deleted: true,
        verifiedAbsent: true,
        bytesWritten: 16,
      },
    });
  });

  it("formats structured diagnostic record for failed license", () => {
    const record = formatSandboxV2LicenseAudit({
      state: "failed",
      taskId: "v2-m1-67890",
      profile: "sandbox_workspace_file_roundtrip",
      sourceMessageEntityUuid: "uuid-def-456",
      error: "timeout",
    });

    expect(record).toEqual({
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: "uuid-def-456",
      state: "failed",
      taskId: "v2-m1-67890",
      profile: "sandbox_workspace_file_roundtrip",
      verified: false,
      error: "timeout",
      refusalReason: null,
      effect: null,
    });
  });

  it("returns null for non-roundtrip profiles", () => {
    const record = formatSandboxV2LicenseAudit({
      state: "succeeded",
      taskId: "other-task-1",
      profile: "build_regression",
    });

    expect(record).toBeNull();
  });

  it("emits to sink with stable discriminator prefix", () => {
    const sink = vi.fn();
    emitSandboxV2LicenseAudit(
      {
        state: "succeeded",
        taskId: "v2-m1-555",
        profile: "sandbox_workspace_file_roundtrip",
        sourceMessageEntityUuid: "uuid-msg-555",
        effectEvidence: {
          verified: true,
          workspaceId: "ws-1",
          relativePath: "test.txt",
          bytesWritten: 10,
          contentHash: "hash-555",
          readMatches: true,
          deleted: true,
          verifiedAbsent: true,
          completedAtMs: 12345,
        },
      },
      sink,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    const line = sink.mock.calls[0][0];
    expect(line).toMatch(/^\[ASHLEY_SANDBOX_V2_LICENSE\] /);
    const parsed = JSON.parse(line.replace(/^\[ASHLEY_SANDBOX_V2_LICENSE\] /, ""));
    expect(parsed.discriminator).toBe("ASHLEY_SANDBOX_V2_LICENSE");
    expect(parsed.taskId).toBe("v2-m1-555");
    expect(parsed.verified).toBe(true);
    expect(parsed.sourceMessageEntityUuid).toBe("uuid-msg-555");
  });
});

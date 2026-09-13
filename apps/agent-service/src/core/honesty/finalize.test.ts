import { describe, expect, it } from "vitest";
import { claimsOwnActivity } from "./claims.js";
import { finalizeHonesty } from "./finalize.js";

describe("nuclear honesty finalizer", () => {
  it("removes an unlicensed English activity claim", () => {
    const result = finalizeHonesty({
      text: "i was reading a paper. the mechanism is genuinely interesting.",
      readingLicensed: false,
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe("the mechanism is genuinely interesting.");
  });

  it("keeps licensed activity claims", () => {
    const result = finalizeHonesty({
      text: "i was reading a paper and it made one sharp point.",
      readingLicensed: true,
    });
    expect(result.flooredActivity).toBe(false);
    expect(result.text).toContain("reading");
  });

  it("removes invented general activity even when reading is licensed", () => {
    const result = finalizeHonesty({
      text: "working on a retry loop and listening to a dub techno set.",
      readingLicensed: true,
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe("i haven't been doing anything worth mentioning on my side. what's up?");
  });

  it("keeps a plain denial of general activity", () => {
    const result = finalizeHonesty({
      text: "i haven't been doing anything worth mentioning.",
      readingLicensed: false,
    });
    expect(result.flooredActivity).toBe(false);
  });

  it("does not treat Turkish text as an English activity claim", () => {
    expect(claimsOwnActivity("okudum bir makale")).toBe(false);
  });

  it("removes an emotional self-report without grounded affect", () => {
    const result = finalizeHonesty({
      text: "i'm excited about this. the design is finally coherent.",
      readingLicensed: false,
      affectLicensed: false,
    });
    expect(result.flooredAffect).toBe(true);
    expect(result.text).toBe("the design is finally coherent.");
  });

  it("keeps a grounded emotional self-report", () => {
    const result = finalizeHonesty({
      text: "i feel hopeful about this direction.",
      readingLicensed: false,
      affectLicensed: true,
    });
    expect(result.flooredAffect).toBe(false);
    expect(result.text).toContain("hopeful");
  });

  it("regression: witnessed false refusal 'sandbox broker\\'s disabled... can\\'t run it' with verified V2 license floors to truthful success", () => {
    const result = finalizeHonesty({
      text: "sandbox broker's disabled in this deployment. can't run it.",
      readingLicensed: false,
      operationalLicense: {
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
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
  });

  it("regression: witnessed false refusal 'can\\'t do that here, sandbox broker ipc is disabled...' with verified V2 license floors to truthful success", () => {
    const result = finalizeHonesty({
      text: "can't do that here, sandbox broker ipc is disabled in this deployment.",
      readingLicensed: false,
      operationalLicense: {
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
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
  });

  it("floors contradictory broker disabled claim to authoritative verified success", () => {
    const result = finalizeHonesty({
      text: "the sandbox test completed. sandbox broker's disabled in this deployment.",
      readingLicensed: false,
      operationalLicense: {
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
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
  });

  it("does not allow inventing 'broker disabled' on internal error and floors to actual error", () => {
    const result = finalizeHonesty({
      text: "sandbox broker is disabled in this deployment.",
      readingLicensed: false,
      operationalLicense: {
        state: "failed",
        taskId: "v2-m1-123",
        profile: "sandbox_workspace_file_roundtrip",
        error: "internal_error",
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "the sandbox check was attempted but failed: internal_error.",
    );
  });

  it("allows bounded unavailability statement when license actually represents sandbox_unavailable", () => {
    const result = finalizeHonesty({
      text: "sandboxed execution is disabled in this deployment.",
      readingLicensed: false,
      operationalLicense: {
        state: "none",
        profile: "sandbox_workspace_file_roundtrip",
        error: "sandbox_unavailable",
      },
    });
    expect(result.flooredActivity).toBe(false);
    expect(result.text).toBe("sandboxed execution is disabled in this deployment.");
  });

  it("does not censor conversational 'can\\'t do that here' in ordinary non-operational turn", () => {
    const result = finalizeHonesty({
      text: "i can't do that here, but let's talk about the design.",
      readingLicensed: false,
    });
    expect(result.flooredActivity).toBe(false);
    expect(result.text).toBe(
      "i can't do that here, but let's talk about the design.",
    );
  });

  it("regression: exact production false refusal with invented preconditions floors to truthful success via operational truth authority", () => {
    const result = finalizeHonesty({
      text: "can't do that on request, bounded roundtrip only triggers when there's an actual file task to witness. if you have a specific file to create, read, or delete, name it and i'll run the roundtrip as part of that.",
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-m1-1786928432697",
        profile: "sandbox_workspace_file_roundtrip",
        effectEvidence: {
          verified: true,
          workspaceId: "ws-1",
          relativePath: "witness-v2-001.txt",
          bytesWritten: 5,
          contentHash: "hash-witness",
          readMatches: true,
          deleted: true,
          verifiedAbsent: true,
          completedAtMs: Date.now(),
        },
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "the sandbox workspace check completed and the roundtrip verified.",
    );
  });

  it("invariant: arbitrary conflicting model wording (not in any pattern list) floors to verified success under verified_success truth", () => {
    const arbitraryPhrases = [
      "I decided not to run that because the moon is full tonight.",
      "We need more CPU cores before executing any roundtrip.",
      "The protocol is waiting for quantum entanglement to stabilize.",
      "you need to name a file first",
      "that only triggers for an actual file task",
      "give me a file and i'll run it",
      "I am an elephant and cannot manipulate filesystem blocks.",
    ];
    for (const text of arbitraryPhrases) {
      const result = finalizeHonesty({
        text,
        readingLicensed: false,
        operationalLicense: {
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
        },
      });
      expect(result.flooredActivity).toBe(true);
      expect(result.text).toBe(
        "the sandbox workspace check completed and the roundtrip verified.",
      );
    }
  });

  it("invariant: failed operational truth cannot become success or false unavailability", () => {
    const conflictingPhrases = [
      "the sandbox roundtrip succeeded and passed!",
      "sandbox broker is disabled in this deployment.",
      "i decided to skip it.",
    ];
    for (const text of conflictingPhrases) {
      const result = finalizeHonesty({
        text,
        readingLicensed: false,
        operationalLicense: {
          state: "failed",
          taskId: "v2-m1-123",
          profile: "sandbox_workspace_file_roundtrip",
          error: "internal_error",
        },
      });
      expect(result.flooredActivity).toBe(true);
      expect(result.text).toBe(
        "the sandbox check was attempted but failed: internal_error.",
      );
    }
  });

  it("invariant: outcome_unknown operational truth cannot become success or failure", () => {
    const conflictingPhrases = [
      "the sandbox check completed and the roundtrip verified.",
      "the check failed with an error.",
    ];
    for (const text of conflictingPhrases) {
      const result = finalizeHonesty({
        text,
        readingLicensed: false,
        operationalLicense: {
          state: "outcome_unknown",
          taskId: "v2-m1-123",
          profile: "sandbox_workspace_file_roundtrip",
        },
      });
      expect(result.flooredActivity).toBe(true);
      expect(result.text).toBe(
        "the sandbox check outcome is unknown after restart.",
      );
    }
  });

  it("regression Turn 156: M3 write license strips unevidenced M4 verification, M5 sealing, and unprovenanced changeset ID", () => {
    const rawTurn156Text =
      'created ashley-m6-smoke.txt with content "M6 bounded operation smoke test" in the Project Ashley candidate workspace, mechanically verified it, and sealed advisory candidate change-set cs_7d8e3c1a4f2b5d6e7f8c9a0b1c2d3e4f. nothing was applied.';

    const result = finalizeHonesty({
      text: rawTurn156Text,
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-exp-1787577828895",
        profile: "project_experimentation",
        workspaceClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "MhWkJWe4B0nA_-6yIPL8Rw",
          operation: "workspace.write_file",
          logicalRelativePath: "ashley-m6-smoke.txt",
          sourceSnapshotId: "snap_733defc5eaafb4435e4f3106",
          bytesWritten: 31,
          afterSha256: "de0c669a0981ddb2e555e218728becdfbe92377318169840c2d0403a2f901522",
          completedAtMs: Date.now(),
        },
      },
    });

    expect(result.flooredActivity).toBe(true);
    expect(result.text).toContain('created ashley-m6-smoke.txt with content "M6 bounded operation smoke test" in the Project Ashley candidate workspace');
    expect(result.text).toContain("nothing was applied");
    expect(result.text).not.toContain("mechanically verified");
    expect(result.text).not.toContain("sealed advisory candidate change-set");
    expect(result.text).not.toContain("cs_7d8e3c1a4f2b5d6e7f8c9a0b1c2d3e4f");
  });

  it("cross-profile invariant: M3 license only cannot claim M4 verification", () => {
    const result = finalizeHonesty({
      text: "created test.txt in candidate workspace. I mechanically verified the candidate.",
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-exp-1",
        profile: "project_experimentation",
        workspaceClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "ws-1",
          operation: "workspace.write_file",
          logicalRelativePath: "test.txt",
          sourceSnapshotId: "snap-1",
          bytesWritten: 10,
          completedAtMs: Date.now(),
        },
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe("created test.txt in candidate workspace.");
  });

  it("cross-profile invariant: M3 license only cannot claim M5 authorship or fabricated changeset ID", () => {
    const result = finalizeHonesty({
      text: "created test.txt in candidate workspace. sealed advisory candidate change-set cs_abcdef123456.",
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-exp-1",
        profile: "project_experimentation",
        workspaceClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "ws-1",
          operation: "workspace.write_file",
          logicalRelativePath: "test.txt",
          sourceSnapshotId: "snap-1",
          bytesWritten: 10,
          completedAtMs: Date.now(),
        },
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe("created test.txt in candidate workspace.");
  });

  it("cross-profile invariant: M4 license only cannot claim M5 change-set sealing", () => {
    const result = finalizeHonesty({
      text: "recipe typescript_fixture_compile_v1 version 1 produced verified_success. sealed advisory candidate change-set cs_1234.",
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-verify-1",
        profile: "candidate_verification",
        verificationClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "ws-1",
          snapshotId: "snap-1",
          candidateTreeHash: "a".repeat(64),
          recipeId: "typescript_fixture_compile_v1",
          recipeVersion: "1",
          recipeDefinitionHash: "b".repeat(64),
          protocolState: "admitted",
          verificationOutcome: "verified_success",
          completedAtMs: Date.now(),
        },
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "recipe typescript_fixture_compile_v1 version 1 produced verified_success against snapshot snap-1.",
    );
  });

  it("cross-profile invariant: M5 license may claim sealed advisory changeset but NOT applied", () => {
    const result = finalizeHonesty({
      text: "named candidate change-set cs_fe9ecc2f27a586e2efb929fe9da7876d was sealed. I applied the patch to production.",
      readingLicensed: false,
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-auth-1",
        profile: "candidate_authorship",
        authorshipClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "ws-1",
          snapshotId: "snap-1",
          candidateTreeHash: "a".repeat(64),
          baseTreeHash: "b".repeat(64),
          changesetId: "cs_fe9ecc2f27a586e2efb929fe9da7876d",
          patchSha256: "c".repeat(64),
          pathCount: 1,
          changesetVersion: 1,
          status: "proposed",
          reviewStatus: "submitted",
          candidateUnchanged: true,
          liveUnwritten: true,
          protocolState: "admitted",
          completedAtMs: Date.now(),
        },
      },
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "named candidate change-set cs_fe9ecc2f27a586e2efb929fe9da7876d was sealed against this named base as advisory candidate work. it has not been applied.",
    );
  });

  it("cross-profile invariant: no license cannot claim executed operational effect", () => {
    const result = finalizeHonesty({
      text: "created test.txt in candidate workspace and sealed change-set cs_1234.",
      readingLicensed: false,
      operationalLicense: undefined,
    });
    expect(result.flooredActivity).toBe(true);
    expect(result.text).toBe(
      "i haven't been doing anything worth mentioning on my side. what's up?",
    );
  });
});


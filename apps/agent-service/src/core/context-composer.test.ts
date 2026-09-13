import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "./db.js";
import { recordIdentityEntry } from "./identity/store.js";
import { patchState } from "./state/store.js";
import { upsertMindStateItem } from "./state/mind-items.js";
import {
  candidateWorkspaceEvidenceBlock,
  projectInspectionEvidenceBlock,
  mindStateHeadline,
  operationalWorkBlock,
  stableIdentityBlock,
} from "./context-composer.js";
import type { WorkspaceExperimentObservation } from "./types.js";
import type { OperationalClaimLicense } from "./sandbox/engineering-types.js";

const OWNER = "doc";

function makeDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

describe("stableIdentityBlock", () => {
  it("renders only value and principle entries, excluding trait, taste, and boundary kinds", () => {
    const db = makeDb();
    const block = stableIdentityBlock(db, OWNER);
    expect(block).toContain("## Ashley's stable identity");
    expect(block).toContain("value: accuracy over performance; say what is true");
    expect(block).not.toContain("trait:");
    expect(block).not.toContain("taste:");
    expect(block).not.toContain("boundary:");
    db.close();
  });

  it("excludes dynamic-layer and non-value kinds even within stable layer", () => {
    const db = makeDb();
    recordIdentityEntry(db, OWNER, "dynamic", "value", "Dynamic opinion");
    recordIdentityEntry(db, OWNER, "stable", "belief", "Stable belief entry");
    const block = stableIdentityBlock(db, OWNER);
    expect(block).not.toContain("Dynamic opinion");
    expect(block).not.toContain("Stable belief entry");
    db.close();
  });
});

describe("mindStateHeadline", () => {
  it("falls back to availability only when focus and mood are unset", () => {
    const db = makeDb();
    const headline = mindStateHeadline(db, OWNER);
    expect(headline).toContain("Availability: available");
    expect(headline).not.toContain("Focus:");
    expect(headline).not.toContain("Mood:");
    db.close();
  });

  it("joins focus, mood, and availability without state detail", () => {
    const db = makeDb();
    patchState(db, OWNER, {
      focus: "planning deployment",
      mood: "focused",
    });
    upsertMindStateItem(db, {
      ownerId: OWNER,
      kind: "concern",
      text: "long-range plan",
      sourceType: "episode",
      sourceId: "1",
    });
    const headline = mindStateHeadline(db, OWNER);
    expect(headline).toBe(
      "Focus: planning deployment | Mood: focused | Availability: available",
    );
    expect(headline).not.toContain("concern");
    expect(headline).not.toContain("Unfinished");
    db.close();
  });

  it("always carries availability even when focus and mood are cleared", () => {
    const db = makeDb();
    patchState(db, OWNER, { focus: null, mood: null });
    expect(mindStateHeadline(db, OWNER)).toBe("Availability: available");
    db.close();
  });
});

describe("operationalWorkBlock", () => {
  it("projects V2 succeeded with verified effect evidence without a coordinator task", () => {
    const db = makeDb();
    const block = operationalWorkBlock(db, OWNER, {
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-m1-999",
        profile: "sandbox_workspace_file_roundtrip",
        effectEvidence: {
          verified: true,
          workspaceId: "ws-1",
          relativePath: "test.txt",
          bytesWritten: 12,
          contentHash: "hash-abc",
          readMatches: true,
          deleted: true,
          verifiedAbsent: true,
          completedAtMs: Date.now(),
        },
      },
    });
    expect(block).toContain("## Operational work state (cognitive attention only)");
    expect(block).toContain("Status: succeeded");
    expect(block).toContain("Profile: sandbox_workspace_file_roundtrip");
    expect(block).toContain("Task ID: v2-m1-999");
    expect(block).toContain("Effect evidence: roundtrip verified (temporary file created, exact bytes verified on read, file deleted, verified absent).");
    expect(block).toContain("Current operational truth: verified_success (authoritative current-turn result; overrides generic capability self-model).");
    db.close();
  });

  it("projects V2 failed with exact error code without a coordinator task", () => {
    const db = makeDb();
    const block = operationalWorkBlock(db, OWNER, {
      operationalLicense: {
        state: "failed",
        taskId: "v2-m1-888",
        profile: "sandbox_workspace_file_roundtrip",
        error: "internal_error",
      },
    });
    expect(block).toContain("Status: failed");
    expect(block).toContain("Profile: sandbox_workspace_file_roundtrip");
    expect(block).toContain("Task ID: v2-m1-888");
    expect(block).toContain("Error: internal_error");
    db.close();
  });

  it("fails closed with non-licensing wording when succeeded evidence is unverified / malformed", () => {
    const db = makeDb();
    const block = operationalWorkBlock(db, OWNER, {
      operationalLicense: {
        state: "succeeded",
        taskId: "v2-m1-777",
        profile: "sandbox_workspace_file_roundtrip",
        effectEvidence: {
          verified: true,
          workspaceId: "ws-1",
          relativePath: "test.txt",
          bytesWritten: 12,
          contentHash: "hash-abc",
          readMatches: false, // malformed / unverified!
          deleted: true,
          verifiedAbsent: true,
          completedAtMs: Date.now(),
        },
      },
    });
    expect(block).toContain("Status: succeeded");
    expect(block).toContain("Effect evidence: unverified (state is succeeded; verified effect evidence is unavailable; no completion licensed).");
    expect(block).not.toContain("roundtrip verified (temporary file created");
    db.close();
  });

  it("returns empty when non-roundtrip profile has no coordinator task", () => {
    const db = makeDb();
    const block = operationalWorkBlock(db, OWNER, {
      operationalLicense: {
        state: "succeeded",
        taskId: "other-task-1",
        profile: "build_regression",
      },
    });
    expect(block).toBe("");
    db.close();
  });
});

function verifiedWriteLicense(
  overrides: Partial<OperationalClaimLicense> = {},
): OperationalClaimLicense {
  return {
    state: "succeeded",
    taskId: "v2-exp-1",
    profile: "project_experimentation",
    workspaceClaimEffect: {
      verified: true,
      projectId: "project-ashley",
      workspaceId: "ws-m3-1",
      operation: "workspace.write_file",
      logicalRelativePath: "m3-witness.txt",
      sourceSnapshotId: "snap_abc",
      bytesWritten: 13,
      completedAtMs: Date.now(),
    },
    ...overrides,
  };
}

function writeObservation(
  overrides: Partial<WorkspaceExperimentObservation> = {},
): WorkspaceExperimentObservation {
  return {
    kind: "workspace_experiment_observation",
    projectId: "project-ashley",
    workspaceId: "ws-m3-1",
    operation: "workspace.write_file",
    verified: true,
    executedAtMs: Date.now(),
    logicalRelativePath: "m3-witness.txt",
    bytesWritten: 13,
    sourceSnapshotId: "snap_abc",
    ...overrides,
  };
}

describe("candidateWorkspaceEvidenceBlock", () => {
  it("treats a verified project_experimentation write as verified_success, not not_performed", () => {
    const block = candidateWorkspaceEvidenceBlock(
      verifiedWriteLicense(),
      writeObservation(),
      { capabilityAvailable: true },
    );
    expect(block).toContain("capabilityAvailable = true");
    expect(block).toContain("workspaceStatus = verified_success");
    expect(block).toContain("verifiedWorkspaceEffect = true");
    expect(block).toContain("candidateWorkspaceChanged = true");
    expect(block).toContain("liveRepositoryUnchanged = true");
    expect(block).toContain("the private candidate workspace changed; the live repository did not.");
    expect(block).not.toContain("workspaceStatus = not_performed");
  });

  it("keeps capability available orthogonal from a failed this-turn attempt", () => {
    const block = candidateWorkspaceEvidenceBlock(
      {
        state: "failed",
        taskId: "v2-exp-2",
        profile: "project_experimentation",
        error: "hash_mismatch",
      },
      null,
      { capabilityAvailable: true },
    );
    expect(block).toContain("capabilityAvailable = true");
    expect(block).toContain("workspaceStatus = failed");
    expect(block).toContain("verifiedWorkspaceEffect = false");
    expect(block).toContain("liveRepositoryUnchanged = true");
    expect(block).toContain("error = hash_mismatch");
    expect(block).not.toContain("workspaceStatus = not_performed");
  });

  it("does not claim candidate mutation for a verified workspace read", () => {
    const block = candidateWorkspaceEvidenceBlock(
      verifiedWriteLicense({
        workspaceClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "ws-m3-1",
          operation: "workspace.read_file",
          logicalRelativePath: "m3-witness.txt",
          sourceSnapshotId: "snap_abc",
          bytesRead: 13,
          completedAtMs: Date.now(),
        },
      }),
      writeObservation({
        operation: "workspace.read_file",
        bytesWritten: undefined,
        bytesRead: 13,
      }),
      { capabilityAvailable: true },
    );
    expect(block).toContain("workspaceStatus = verified_success");
    expect(block).toContain("candidateWorkspaceChanged = false");
    expect(block).toContain("liveRepositoryUnchanged = true");
    expect(block).not.toContain("workspaceStatus = not_performed");
  });
});

describe("projectInspectionEvidenceBlock", () => {
  it("does not treat Thought attention_deadline as a missing user ask", () => {
    const block = projectInspectionEvidenceBlock(null, null, {
      capabilityAvailable: true,
      thoughtCompleted: false,
      thoughtError: "attention_deadline",
    });
    expect(block).toContain("capabilityAvailable = true");
    expect(block).toContain("inspectionStatus = not_performed");
    expect(block).toContain("thoughtCompleted = false");
    expect(block).toContain("thoughtError = attention_deadline");
    expect(block).toContain("inspection could not be requested or executed");
    expect(block).toContain("Do not invite the user to ask for inspection");
    expect(block).not.toContain("this is not an inability and must never be expressed as one");
  });

  it("keeps available + not_performed when Thought completed without inspecting", () => {
    const block = projectInspectionEvidenceBlock(null, null, {
      capabilityAvailable: true,
      thoughtCompleted: true,
    });
    expect(block).toContain(
      "capabilityAvailable = true with inspectionStatus = not_performed means Ashley CAN inspect approved projects but did not inspect this turn",
    );
    expect(block).not.toContain("thoughtError = attention_deadline");
  });
});

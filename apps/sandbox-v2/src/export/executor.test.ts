import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizePath, type ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import { V2ProjectReadRegistry } from "../registry.js";
import { executePatchExport } from "./executor.js";
import { isForbiddenM7Profile, refuseUnadmittedM7Profile } from "./forbidden.js";
import { isPatchExportResult } from "../v2-types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const canonical = canonicalizePath(realpathSync(dir));
  if (!canonical.ok) throw new Error("tmp_not_canonical");
  tempDirs.push(canonical.value);
  return canonical.value;
}

function entry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "composer-assistant",
    canonicalRoot: "/srv/projects/composer-assistant",
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
    ...overrides,
  };
}

describe("M7 patch_export kernel", () => {
  it("copies a sealed artifact to the operator destination and witnesses the digest", () => {
    const sourceDir = tmp("ashley-m7-src-");
    const destRoot = tmp("ashley-m7-dst-");
    const artifactRef = `${sourceDir}/sealed.patch`;
    const body = "diff --git a/src/a.ts b/src/a.ts\n";
    writeFileSync(artifactRef, body, { mode: 0o600 });
    const expectedSha256 = createHash("sha256").update(body, "utf8").digest("hex");
    const changesetId = "cs_" + "ab".repeat(16);
    const registry = new V2ProjectReadRegistry([
      entry({
        patchExportAllowed: true,
        exportDestinationCanonicalRoot: destRoot,
      }),
    ]);
    const result = executePatchExport(
      {
        version: 2,
        operation: "patch_export",
        projectId: "composer-assistant",
        changesetId,
        artifactRef,
        expectedSha256,
        destinationRoot: destRoot,
      },
      { registry },
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") return;
    expect(isPatchExportResult(result.result)).toBe(true);
    if (result.result.kind !== "patch_export") return;
    expect(result.result.applied).toBe(false);
    expect(result.result.liveUnwritten).toBe(true);
    expect(result.result.gitUnwritten).toBe(true);
    expect(result.result.witnessedSha256).toBe(expectedSha256);
    expect(readFileSync(`${destRoot}/${changesetId}.patch`, "utf8")).toBe(body);
  });

  it("refuses when patchExportAllowed is closed", () => {
    const sourceDir = tmp("ashley-m7-deny-src-");
    const destRoot = tmp("ashley-m7-deny-dst-");
    const artifactRef = `${sourceDir}/sealed.patch`;
    writeFileSync(artifactRef, "x");
    const expectedSha256 = createHash("sha256").update("x").digest("hex");
    const registry = new V2ProjectReadRegistry([
      entry({
        authorshipAllowed: true,
        operationAllowed: true,
        patchExportAllowed: false,
      }),
    ]);
    const result = executePatchExport(
      {
        version: 2,
        operation: "patch_export",
        projectId: "composer-assistant",
        changesetId: "cs_" + "cd".repeat(16),
        artifactRef,
        expectedSha256,
        destinationRoot: destRoot,
      },
      { registry },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("patch_export_not_allowed");
  });

  it("refuses a destination that is not the operator root", () => {
    const sourceDir = tmp("ashley-m7-mis-src-");
    const destRoot = tmp("ashley-m7-mis-dst-");
    const other = tmp("ashley-m7-other-");
    const artifactRef = `${sourceDir}/sealed.patch`;
    writeFileSync(artifactRef, "x");
    const expectedSha256 = createHash("sha256").update("x").digest("hex");
    const registry = new V2ProjectReadRegistry([
      entry({
        patchExportAllowed: true,
        exportDestinationCanonicalRoot: destRoot,
      }),
    ]);
    const result = executePatchExport(
      {
        version: 2,
        operation: "patch_export",
        projectId: "composer-assistant",
        changesetId: "cs_" + "ef".repeat(16),
        artifactRef,
        expectedSha256,
        destinationRoot: other,
      },
      { registry },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("destination_mismatch");
  });

  it("is idempotent when the destination already holds the same digest", () => {
    const sourceDir = tmp("ashley-m7-id-src-");
    const destRoot = tmp("ashley-m7-id-dst-");
    const artifactRef = `${sourceDir}/sealed.patch`;
    writeFileSync(artifactRef, "same");
    const expectedSha256 = createHash("sha256").update("same").digest("hex");
    const changesetId = "cs_" + "11".repeat(16);
    mkdirSync(destRoot, { recursive: true });
    writeFileSync(`${destRoot}/${changesetId}.patch`, "same");
    const registry = new V2ProjectReadRegistry([
      entry({
        patchExportAllowed: true,
        exportDestinationCanonicalRoot: destRoot,
      }),
    ]);
    const result = executePatchExport(
      {
        version: 2,
        operation: "patch_export",
        projectId: "composer-assistant",
        changesetId,
        artifactRef,
        expectedSha256,
        destinationRoot: destRoot,
      },
      { registry },
    );
    expect(result.outcome).toBe("succeeded");
  });

  it("refuses when the destination already holds a different digest", () => {
    const sourceDir = tmp("ashley-m7-conf-src-");
    const destRoot = tmp("ashley-m7-conf-dst-");
    const artifactRef = `${sourceDir}/sealed.patch`;
    writeFileSync(artifactRef, "new");
    const expectedSha256 = createHash("sha256").update("new").digest("hex");
    const changesetId = "cs_" + "22".repeat(16);
    writeFileSync(`${destRoot}/${changesetId}.patch`, "old");
    const registry = new V2ProjectReadRegistry([
      entry({
        patchExportAllowed: true,
        exportDestinationCanonicalRoot: destRoot,
      }),
    ]);
    const result = executePatchExport(
      {
        version: 2,
        operation: "patch_export",
        projectId: "composer-assistant",
        changesetId,
        artifactRef,
        expectedSha256,
        destinationRoot: destRoot,
      },
      { registry },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("destination_conflict");
    expect(readFileSync(`${destRoot}/${changesetId}.patch`, "utf8")).toBe("old");
  });

  it("keeps later profiles refuse-closed", () => {
    expect(isForbiddenM7Profile("live_apply")).toBe(true);
    expect(isForbiddenM7Profile("git_commit")).toBe(true);
    expect(isForbiddenM7Profile("git_push")).toBe(true);
    expect(isForbiddenM7Profile("patch_export")).toBe(false);
    expect(refuseUnadmittedM7Profile().error).toBe("m7_profile_forbidden");
  });
});

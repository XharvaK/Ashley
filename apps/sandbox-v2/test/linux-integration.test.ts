/**
 * Linux-only real-boundary integration test (Sandbox V2 M2).
 *
 * Runs the full host pipeline on the real Bubblewrap substrate: registry
 * resolution -> sanitized view -> real bwrap spawn -> embedded runner ->
 * host evidence validation -> typed result. Skipped anywhere bwrap is not
 * present (including the Windows dev machine); physical qualification on the
 * production Mint host happens separately.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeProjectInspection } from "../src/project-inspection/executor.js";
import { V2ProjectReadRegistry } from "../src/registry.js";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";

const canRunReal = process.platform === "linux" && existsSync("/usr/bin/bwrap");

const EMPTY_PROTECTED: ProtectedRootsConfig = {
  delegatedWriteDeniedOwnerApprovable: [],
  absoluteDenial: [],
};

describe.skipIf(!canRunReal)("sandbox-v2 project inspection (real bwrap)", () => {
  it(
    "crosses the real boundary: registry -> view -> bwrap -> runner -> typed result",
    async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), "ashley-v2-proj-"));
      try {
        mkdirSync(join(projectRoot, "src"));
        writeFileSync(join(projectRoot, "src", "main.ts"), "const x = 1;\nconsole.log(x);\n", "utf8");
        writeFileSync(join(projectRoot, ".env"), "SECRET=1", "utf8");
        writeFileSync(join(projectRoot, "README.md"), "# Project\n", "utf8");

        const registry = new V2ProjectReadRegistry([
          {
            projectId: "real-project",
            canonicalRoot: projectRoot,
            displayName: "Real Project",
            enabled: true,
            readAllowed: true,
            candidateWorkspaceAllowed: false,
            engineeringAllowed: false,
          },
        ]);

        const result = await executeProjectInspection(
          { version: 2, operation: "project.read_file", projectId: "real-project", path: "src/main.ts" },
          { registry, protectedRoots: EMPTY_PROTECTED, timeoutMs: 60_000 },
        );
        expect(result.outcome).toBe("succeeded");
        if (result.outcome === "succeeded") {
          expect(result.result.kind).toBe("project.read_file");
          expect(result.result.path).toBe("src/main.ts");
          expect(Buffer.from(result.result.contentBase64, "base64").toString("utf8")).toBe(
            "const x = 1;\nconsole.log(x);\n",
          );
          expect(result.result.truncated).toBe(false);
        }
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
    90_000,
  );

  it(
    "refuses a traversal escape at the real boundary",
    async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), "ashley-v2-proj-"));
      try {
        writeFileSync(join(projectRoot, "a.txt"), "x", "utf8");
        const registry = new V2ProjectReadRegistry([
          {
            projectId: "real-project",
            canonicalRoot: projectRoot,
            displayName: "Real Project",
            enabled: true,
            readAllowed: true,
            candidateWorkspaceAllowed: false,
            engineeringAllowed: false,
          },
        ]);
        const result = await executeProjectInspection(
          { version: 2, operation: "project.read_file", projectId: "real-project", path: "../a.txt" },
          { registry, protectedRoots: EMPTY_PROTECTED, timeoutMs: 60_000 },
        );
        expect(result.outcome).toBe("failed");
        if (result.outcome === "failed") expect(result.error).toBe("path_invalid");
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
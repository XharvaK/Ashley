import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { COMMAND_CODE_WORKER_PINNED_VERSION } from "../../sandbox/worker/command-code-worker.js";
import { openNuclearDb } from "../../db.js";
import { listCapabilityStatuses } from "../../rollout/capabilities.js";
import { getCapabilityReality } from "./capability-reality.js";

const installs: Array<{ cleanup(): void }> = [];

function fakeReadyRuntime(pin = COMMAND_CODE_WORKER_PINNED_VERSION) {
  const root = mkdtempSync(join(tmpdir(), "ccw-projection-"));
  const nodeBin = join(root, "runtime", "bin", "node");
  const packageDir = join(root, "runtime", "lib", "node_modules", "command-code");
  const script = join(packageDir, "dist", "index.mjs");
  mkdirSync(dirname(nodeBin), { recursive: true });
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(nodeBin, "node", "utf8");
  writeFileSync(script, "// cli entry", "utf8");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "command-code", version: pin }), "utf8");
  const bubblewrap = join(root, "bwrap");
  writeFileSync(bubblewrap, "bwrap", "utf8");
  const install = {
    binaryPath: script,
    bubblewrapPath: bubblewrap,
    nodeExecutable: nodeBin,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  installs.push(install);
  return install;
}

afterAll(() => {
  for (const install of installs) install.cleanup();
});

function activeDb(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  listCapabilityStatuses(db, "apply");
  db.prepare("UPDATE capability_releases SET state = 'active'").run();
  return db;
}

function registry(engineeringAllowed: boolean, authorshipAllowed = true): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([{
    projectId: "project-ashley",
    canonicalRoot: "/srv/projects/project-ashley",
    displayName: "Project Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed,
    verificationAllowed: true,
    allowedRecipeIds: ["recipe-1"],
    authorshipAllowed,
    operationAllowed: true,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
  }]);
}

function readyBackendOptions() {
  const install = fakeReadyRuntime();
  return {
    commandCodeWorkerEnabled: true,
    commandCodeApiKey: "test-key",
    commandCodeBinaryPath: install.binaryPath,
    commandCodePinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
    commandCodeBubblewrapPath: install.bubblewrapPath,
    commandCodeNodeExecutable: install.nodeExecutable,
  };
}

function developRow(reality: ReturnType<typeof getCapabilityReality>) {
  return reality.operationCapabilities?.find((operation) => operation.operationKind === "candidate.develop");
}

describe("candidate.develop selected-backend DEVELOP availability", () => {
  it("offers authoring when the selected Command Code backend is DEVELOP-ready and grants are provisioned", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        ...readyBackendOptions(),
      });
      expect(developRow(reality)).toMatchObject({
        available: true,
        unavailableReasons: [],
        authorizedProjectIds: ["project-ashley"],
      });
      expect(reality.canOfferIterativeEngineering).toBe(true);
    } finally {
      db.close();
    }
  });

  it("is independent of the superseded OpenCode substrate enablement", () => {
    const db = activeDb();
    try {
      const withOpenCodeReady = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        opencodeWorkerEnabled: true,
        ...readyBackendOptions(),
      } as Parameters<typeof getCapabilityReality>[1]);
      const withOpenCodeDisabled = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        opencodeWorkerEnabled: false,
        ...readyBackendOptions(),
      });
      expect(developRow(withOpenCodeReady)).toMatchObject({ available: true });
      expect(developRow(withOpenCodeDisabled)).toMatchObject({ available: true, unavailableReasons: [] });
    } finally {
      db.close();
    }
  });

  it("does not let unrelated INVESTIGATE readiness prove DEVELOP readiness", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        // OpenCode substrate enabled and resolved: the worker-backed
        // INVESTIGATE leg is available, but it is not the DEVELOP backend.
        opencodeWorkerEnabled: true,
        opencodeBinaryPath: process.execPath,
        opencodeQuotaStatePath: "this-path-does-not-exist.json",
      } as Parameters<typeof getCapabilityReality>[1]);
      expect(reality.operationCapabilities?.find((operation) => operation.operationKind === "project.inspect"))
        .toMatchObject({ available: true });
      const develop = developRow(reality);
      expect(develop).toMatchObject({ available: false });
      expect(develop?.unavailableReasons).toEqual(["develop_worker_disabled"]);
      expect(reality.canOfferIterativeEngineering).toBe(false);
    } finally {
      db.close();
    }
  });

  it("reveals later blockers once an early blocker is fixed instead of assuming success", () => {
    const db = activeDb();
    try {
      const disabled = getCapabilityReality(db, {
        registry: registry(false),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      expect(developRow(disabled)?.unavailableReasons).toEqual([
        "develop_worker_disabled",
        "engineering_not_authorized",
      ]);

      const wrongPin = getCapabilityReality(db, {
        registry: registry(false),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        commandCodeWorkerEnabled: true,
        commandCodeApiKey: "test-key",
        commandCodeBinaryPath: "/definitely/not/installed",
        commandCodePinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
        commandCodeBubblewrapPath: "/definitely/not/bwrap",
      });
      expect(developRow(wrongPin)?.unavailableReasons).toEqual([
        "develop_worker_binary_unavailable",
        "engineering_not_authorized",
      ]);

      // Authority fixed while the backend is still broken: the backend
      // blocker remains, and the target appears authorized.
      const grantedStillBroken = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        commandCodeWorkerEnabled: true,
        commandCodeApiKey: "test-key",
        commandCodeBinaryPath: "/definitely/not/installed",
        commandCodePinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
        commandCodeBubblewrapPath: "/definitely/not/bwrap",
      });
      const develop = developRow(grantedStillBroken);
      expect(develop?.available).toBe(false);
      expect(develop?.unavailableReasons).toEqual(["develop_worker_binary_unavailable"]);
      expect(develop?.authorizedProjectIds).toEqual(["project-ashley"]);

      // Backend fixed while lifecycle is off: workspace availability blocker shows.
      const lifecycleOff = getCapabilityReality(db, {
        registry: registry(true),
        masterMode: "apply",
        lifecycleEnabled: false,
        substrateAvailable: true,
        ...readyBackendOptions(),
      });
      expect(developRow(lifecycleOff)?.unavailableReasons).toEqual(["candidate_workspace_unavailable"]);
    } finally {
      db.close();
    }
  });

  it("never lets authorshipAllowed substitute for the engineering grant", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(false, true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        ...readyBackendOptions(),
      });
      const develop = developRow(reality);
      expect(develop).toMatchObject({ available: false });
      expect(develop?.unavailableReasons).toContain("engineering_not_authorized");
      expect(develop?.authorizedProjectIds).toEqual([]);
      expect(reality.canOfferAuthorship).toBe(true);
      expect(reality.canOfferIterativeEngineering).toBe(false);

      const granted = getCapabilityReality(db, {
        registry: registry(true, true),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
        ...readyBackendOptions(),
      });
      expect(developRow(granted)).toMatchObject({ available: true });
    } finally {
      db.close();
    }
  });

  it("keeps an unavailable candidate.develop visible with its full bounded contract and no fabricated quota claims", () => {
    const db = activeDb();
    try {
      const reality = getCapabilityReality(db, {
        registry: registry(false),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      const develop = developRow(reality);
      expect(develop).toMatchObject({
        semanticClass: "effect",
        readOnly: false,
        requiresProject: true,
        available: false,
        requiredRequestFields: ["projectId"],
        operatorBoundRequestFields: ["workspaceId"],
      });
      expect(develop?.label).toEqual(expect.any(String));
      expect(develop?.description).toEqual(expect.any(String));
      expect(develop?.inputContract).toEqual(expect.any(String));
      expect(develop?.outputContract).toEqual(expect.any(String));
      expect(develop?.evidenceContract).toEqual(expect.any(String));
      expect(develop?.authorityConditions.length).toBeGreaterThan(0);
      expect(develop?.hardLimits.length).toBeGreaterThan(0);
      expect(develop?.uncertainty.length).toBeGreaterThan(0);
      for (const reason of develop?.unavailableReasons ?? []) {
        expect(reason).toMatch(/^develop_worker_|^candidate_workspace_unavailable$|^engineering_not_authorized$/);
      }
      expect(JSON.stringify(develop)).not.toMatch(/quota|NVIDIA|OpenCode|opencode/);
    } finally {
      db.close();
    }
  });
});

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { COMMAND_CODE_WORKER_PINNED_VERSION } from "../../sandbox/worker/command-code-worker.js";
import { openNuclearDb } from "../../db.js";
import { listCapabilityStatuses } from "../../rollout/capabilities.js";
import { getCapabilityReality, type CapabilityRealityOptions } from "../thought/capability-reality.js";
import { evaluateModificationSolvability } from "./solvability-preflight.js";

const installs: Array<{ cleanup(): void }> = [];

function fakeReadyRuntime(pin = COMMAND_CODE_WORKER_PINNED_VERSION) {
  const root = mkdtempSync(join(tmpdir(), "ccw-preflight-"));
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

function registry(engineeringAllowed: boolean): V2ProjectReadRegistry {
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
    authorshipAllowed: true,
    operationAllowed: true,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
  }]);
}

const CONTROLS = {
  interruptionRevocationDeclared: true,
  boundsClosureDeclared: true,
  evidenceCaptureDeclared: true,
};

function baseInput(
  db: DatabaseSync,
  registryInstance: V2ProjectReadRegistry,
  overrides: {
    engineeringAllowed?: boolean;
    realityOptions?: CapabilityRealityOptions;
    worker?: Partial<Parameters<typeof evaluateModificationSolvability>[0]["worker"]>;
  } = {},
) {
  const engineeringAllowed = overrides.engineeringAllowed ?? true;
  const effectiveRegistry = engineeringAllowed === true ? registryInstance : registry(false);
  const realityOptions = overrides.realityOptions ?? {};
  const worker = {
    workerEnabled: true,
    apiKey: "test-key",
    binaryPath: "/definitely/not/installed",
    pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
    bubblewrapPath: "/definitely/not/bwrap",
    ...overrides.worker,
  };
  const capabilityReality = getCapabilityReality(db, {
    registry: effectiveRegistry,
    masterMode: "apply",
    lifecycleEnabled: true,
    substrateAvailable: true,
    ...realityOptions,
  });
  return {
    candidateIdentity: { head: "a".repeat(40), tree: "b".repeat(40) },
    workerIdentity: { backend: "command_code", profile: "develop", pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION },
    resourceIdentity: { hostMaxSteps: 128, cliMaxTurns: 128 },
    db,
    registry: effectiveRegistry,
    capabilityReality,
    projectId: "project-ashley",
    workspace: { workspaceId: "ws-1", workspaceTreeRoot: "/managed/ws-1" },
    worker,
    recipeId: "recipe-1",
    masterMode: "apply" as const,
    lifecycleEnabled: true,
    controls: CONTROLS,
  };
}

describe("modification solvability preflight", () => {
  it("fails an unsolvable fixture before official dispatch with mechanical blockers", () => {
    const db = activeDb();
    try {
      const result = evaluateModificationSolvability(baseInput(db, registry(false), { engineeringAllowed: false }));
      expect(result.solvable).toBe(false);
      expect(result.blockers).toContain("candidate_develop_offerable_for_target");
      expect(result.blockers).toContain("engineering_authority_effective");
      expect(result.blockers).toContain("selected_develop_backend_ready");
      const offerable = result.checks.find((check) => check.id === "candidate_develop_offerable_for_target");
      expect(offerable?.detail).toContain("available=false");
      expect(offerable?.detail).toContain("engineering_not_authorized");
    } finally {
      db.close();
    }
  });

  it("passes a viable fixture judged by the ordinary capability and readiness owners", () => {
    const db = activeDb();
    try {
      const install = fakeReadyRuntime();
      const result = evaluateModificationSolvability(baseInput(db, registry(true), {
        realityOptions: {
          commandCodeWorkerEnabled: true,
          commandCodeApiKey: "test-key",
          commandCodeBinaryPath: install.binaryPath,
          commandCodePinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
          commandCodeBubblewrapPath: install.bubblewrapPath,
          commandCodeNodeExecutable: install.nodeExecutable,
        },
        worker: {
          binaryPath: install.binaryPath,
          bubblewrapPath: install.bubblewrapPath,
          nodeExecutable: install.nodeExecutable,
        } as Parameters<typeof evaluateModificationSolvability>[0]["worker"],
      }));
      expect(result.solvable).toBe(true);
      expect(result.blockers).toEqual([]);
      expect(result.checks.find((check) => check.id === "authoring_capability_catalogued")?.status).toBe("pass");
      expect(result.checks.find((check) => check.id === "candidate_develop_offerable_for_target")?.status).toBe("pass");
      expect(result.checks.find((check) => check.id === "engineering_authority_effective")?.status).toBe("pass");
      expect(result.checks.find((check) => check.id === "candidate_workspace_bound")?.status).toBe("pass");
      expect(result.checks.find((check) => check.id === "selected_develop_backend_ready")?.status).toBe("pass");
      expect(result.checks.find((check) => check.id === "verification_capability_recipe_bound")?.status).toBe("pass");
    } finally {
      db.close();
    }
  });

  it("reports quota as not applicable for the selected backend instead of fabricating a check", () => {
    const db = activeDb();
    try {
      const result = evaluateModificationSolvability(baseInput(db, registry(true)));
      const quota = result.checks.find((check) => check.id === "engineering_quota_offerable");
      expect(quota?.status).toBe("not_applicable");
      expect(quota?.detail).toContain("no quota owner");
    } finally {
      db.close();
    }
  });

  it("refuses to validate without harness control and evidence declarations", () => {
    const db = activeDb();
    try {
      const result = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        controls: {
          interruptionRevocationDeclared: false,
          boundsClosureDeclared: true,
          evidenceCaptureDeclared: true,
        },
      });
      expect(result.solvable).toBe(false);
      expect(result.blockers).toContain("interruption_revocation_controls");
      expect(result.checks.find((check) => check.id === "bounds_closure_declared")?.status).toBe("pass");
      const missingEvidence = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        controls: { ...CONTROLS, evidenceCaptureDeclared: false },
      });
      expect(missingEvidence.blockers).toContain("evidence_capture_active");
      const missingBounds = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        controls: { ...CONTROLS, boundsClosureDeclared: false },
      });
      expect(missingBounds.blockers).toContain("bounds_closure_declared");
      const noResourceIdentity = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        resourceIdentity: null,
      });
      expect(noResourceIdentity.blockers).toContain("bounds_closure_declared");
    } finally {
      db.close();
    }
  });

  it("never carries an expected operation, sequence, or recommendation", () => {
    const db = activeDb();
    try {
      const result = evaluateModificationSolvability(baseInput(db, registry(true)));
      expect(JSON.stringify(result)).not.toMatch(/expectedOperation|operationSequence|expected_sequence|preferred_operation|recommend/i);
      expect(result.checks.every((check) => typeof check.id === "string" && typeof check.status === "string")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("requires a real workspace acquisition receipt and identity declarations", () => {
    const db = activeDb();
    try {
      const noWorkspace = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        workspace: null,
      });
      expect(noWorkspace.solvable).toBe(false);
      expect(noWorkspace.blockers).toContain("candidate_workspace_bound");
      expect(noWorkspace.blockers).toContain("verification_capability_recipe_bound");

      const noIdentity = evaluateModificationSolvability({
        ...baseInput(db, registry(true)),
        candidateIdentity: { head: "", tree: "" },
      });
      expect(noIdentity.blockers).toContain("candidate_identity_frozen");
    } finally {
      db.close();
    }
  });
});

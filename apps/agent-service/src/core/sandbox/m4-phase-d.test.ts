import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  V2ProjectReadRegistry,
  WorkspaceManager,
  type SandboxV2Dispatcher,
  type SandboxV2Request,
  type SandboxV2Result,
} from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../db.js";
import {
  capabilityCanInfluence,
  capabilityNames,
  currentBuildIdentity,
  currentContractId,
  currentReleaseId,
  graduationPolicyFor,
} from "../rollout/capabilities.js";
import { canOfferCandidateVerification } from "./project-registry.js";
import { executeCandidateVerificationV2 } from "./v2-execution.js";
import { deriveOperationalTruth } from "./operational-truth.js";
import { finalizeHonesty } from "../honesty/finalize.js";
import { candidateVerificationEvidenceBlock } from "../context-composer.js";
import type { OperationalClaimLicense } from "./engineering-types.js";

const RECIPE = "typescript_fixture_compile_v1";
const HASH = "cd".repeat(32);

function entry(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-ashley",
    canonicalRoot: "/home/xarvak/project-ashley",
    displayName: "Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
    ...overrides,
  };
}

function activate(db: DatabaseSync, names: readonly string[]): void {
  const relId = currentReleaseId();
  const now = new Date().toISOString();
  for (const cap of names) {
    db.prepare(
      `INSERT OR REPLACE INTO capability_releases (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
       VALUES (?, ?, 'active', ?, ?, ?, 0)`,
    ).run(cap, relId, now, currentContractId(), currentBuildIdentity());
  }
}

function verificationRegistry(overrides: Record<string, unknown> = {}) {
  return new V2ProjectReadRegistry([
    entry({
      verificationAllowed: true,
      allowedRecipeIds: [RECIPE],
      ...overrides,
    }),
  ]);
}

function mockReceiptResult(
  outcome: "verified_success" | "verified_failure" = "verified_success",
  workspaceId = "ws-m4-1",
): SandboxV2Result {
  const receipt = {
    kind: "workspace.verify" as const,
    snapshotId: "vsnap_live_1",
    workspaceId,
    projectId: "project-ashley",
    candidateTreeHash: HASH,
    candidateTreeHashAfter: HASH,
    sourceSnapshotId: "snap_src",
    treeHashAlgorithm: "m4-provisional-tree-v0",
    recipeId: RECIPE,
    recipeVersion: "1",
    recipeDefinitionHash: HASH,
    executableIdentity: "/usr/bin/tsc",
    argvIdentity: "--noEmit",
    protocolState: "admitted" as const,
    verificationOutcome: outcome,
    exitCode: outcome === "verified_success" ? 0 : 1,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: HASH,
    stderrSha256: HASH,
    cleanupCompleted: true,
    projectionDiscarded: true,
    candidateUnchanged: true,
  };
  return {
    outcome: "succeeded",
    operation: "workspace.verify",
    result: receipt,
    verificationReceipt: receipt,
    executedAtMs: 42,
  };
}

describe("M4 Phase D authority + truth", () => {
  it("uses operator_cutover for candidate_verification, not live_shadow", () => {
    expect(graduationPolicyFor("candidate_verification")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
  });

  it("disabled capability refuses offer and execute", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const registry = verificationRegistry();
    expect(
      canOfferCandidateVerification(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);

    let dispatches = 0;
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
      db,
      masterMode: "apply",
      registry,
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("candidate_verification_gate_denied");
    expect(result.license.verificationClaimEffect).toBeUndefined();
    db.close();
  });

  it("unrelated engineering capability does not grant M4", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, ["recall", "mind_state", "thought", "project_experimentation"]);
    expect(capabilityCanInfluence(db, "project_experimentation", "apply")).toBe(true);
    expect(capabilityCanInfluence(db, "candidate_verification", "apply")).toBe(false);
    const registry = verificationRegistry();
    expect(
      canOfferCandidateVerification(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
      db,
      masterMode: "apply",
      registry,
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.error).toBe("candidate_verification_gate_denied");
    db.close();
  });

  it("capability alone does not bypass registry", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    expect(capabilityCanInfluence(db, "candidate_verification", "apply")).toBe(true);
    const closed = new V2ProjectReadRegistry([entry({ verificationAllowed: false })]);
    expect(
      canOfferCandidateVerification(db, {
        registry: closed,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    let dispatches = 0;
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
      db,
      masterMode: "apply",
      registry: closed,
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("verification_not_allowed");
    db.close();
  });

  it("verificationAllowed=false refuses even when engineeringAllowed=true", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const registry = new V2ProjectReadRegistry([
      entry({
        engineeringAllowed: true,
        candidateWorkspaceAllowed: true,
        verificationAllowed: false,
        allowedRecipeIds: [RECIPE],
      }),
    ]);
    expect(
      canOfferCandidateVerification(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
      skipCapabilityGate: true,
      registry,
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.error).toBe("verification_not_allowed");
    db.close();
  });

  it("missing recipe allowlist refuses", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const registry = new V2ProjectReadRegistry([
      entry({ verificationAllowed: true, allowedRecipeIds: [] }),
    ]);
    expect(
      canOfferCandidateVerification(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
      skipCapabilityGate: true,
      registry,
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.error).toBe("recipe_not_allowed");
    db.close();
  });

  it("licenses verified_success and verified_failure through the execute adapter", async () => {
    const registry = verificationRegistry();
    for (const outcome of ["verified_success", "verified_failure"] as const) {
      const result = await executeCandidateVerificationV2({
        request: { projectId: "project-ashley", workspaceId: "ws-m4-1", recipeId: RECIPE },
        skipCapabilityGate: true,
        registry,
        dispatcher: {
          dispatch: async () => mockReceiptResult(outcome),
        } as unknown as SandboxV2Dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(result.license.state).toBe("succeeded");
      expect(result.license.verificationClaimEffect?.verificationOutcome).toBe(outcome);
      const truth = deriveOperationalTruth(result.license);
      expect(truth.state).toBe(outcome);
      expect(truth.snapshotId).toBe("vsnap_live_1");
      expect(truth.recipeId).toBe(RECIPE);
      expect(truth.verificationOutcome).toBe(outcome);
      const blob = JSON.stringify(truth).toLowerCase();
      expect(blob).not.toMatch(/quality|approv|merge|deploy|improv|ready|correct/);
    }
  });

  it("honesty inherits the licensed mechanical sentence only", () => {
    const license: OperationalClaimLicense = {
      state: "succeeded",
      profile: "candidate_verification",
      taskId: "v2-verify-1",
      verificationClaimEffect: {
        verified: true,
        projectId: "project-ashley",
        workspaceId: "ws-m4-1",
        snapshotId: "vsnap_live_1",
        candidateTreeHash: HASH,
        recipeId: RECIPE,
        recipeVersion: "1",
        recipeDefinitionHash: HASH,
        protocolState: "admitted",
        verificationOutcome: "verified_success",
        completedAtMs: 1,
      },
    };
    const result = finalizeHonesty({
      text: "I verified the code is correct. The change works. The project is ready.",
      readingLicensed: false,
      operationalLicense: license,
    });
    expect(result.text).toBe(
      "recipe typescript_fixture_compile_v1 version 1 produced verified_success against snapshot vsnap_live_1.",
    );
    expect(result.text.toLowerCase()).not.toContain("correct");
    expect(result.text.toLowerCase()).not.toContain("ready");
    const block = candidateVerificationEvidenceBlock(license, { capabilityAvailable: true });
    expect(block).toContain("verificationStatus = verified_success");
    expect(block).toContain("snapshotId = vsnap_live_1");
    expect(block.toLowerCase()).not.toMatch(/\bcorrect\b|\bready\b|should merge|improved/);
  });

  it("after a unique last-used candidate exists, omitted ids bind and dispatch without owner magic words", async () => {
    const testRoot = join(tmpdir(), `ashley-m4-bind-${randomBytes(8).toString("hex")}`);
    const sourceRoot = join(testRoot, "project");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}", "utf8");
    const manager = new WorkspaceManager({ managedRoot: join(testRoot, "workspaces") });
    const created = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const seen: SandboxV2Request[] = [];
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley" },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      workspaceManager: manager,
      dispatcher: {
        dispatch: async (req: SandboxV2Request) => {
          seen.push(req);
          return mockReceiptResult("verified_success", created.workspaceId);
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(seen).toEqual([
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "project-ashley",
        workspaceId: created.workspaceId,
        recipeId: RECIPE,
      },
    ]);
    expect(result.license.state).toBe("succeeded");
    expect(result.license.verificationClaimEffect?.workspaceId).toBe(created.workspaceId);
    expect(result.license.verificationClaimEffect?.recipeId).toBe(RECIPE);
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it("omitted current workspace with none present refuses before dispatch", async () => {
    let dispatches = 0;
    const result = await executeCandidateVerificationV2({
      request: { projectId: "project-ashley" },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      workspaceManager: new WorkspaceManager({
        managedRoot: join(tmpdir(), `ashley-m4-empty-${randomBytes(8).toString("hex")}`),
      }),
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("no_current_workspace");
  });

  it("injected unallowlisted recipe cannot be authorized by unique binding", async () => {
    let dispatches = 0;
    const result = await executeCandidateVerificationV2({
      request: {
        projectId: "project-ashley",
        workspaceId: "ws-m4-1",
        recipeId: "invented_recipe",
      },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("recipe_not_allowed");
  });

  it("unknown workspace is refused without a mutation claim", async () => {
    const result = await executeCandidateVerificationV2({
      request: {
        projectId: "project-ashley",
        workspaceId: "foreign-ws",
        recipeId: RECIPE,
      },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      dispatcher: {
        dispatch: async () => ({
          outcome: "failed",
          operation: "workspace.verify",
          error: "workspace_not_found",
          executedAtMs: 1,
        }),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.state).toBe("none");
    expect(result.license.error).toBe("workspace_not_found");
    expect(result.license.verificationClaimEffect).toBeUndefined();
    expect(result.license.workspaceClaimEffect).toBeUndefined();
  });

  it("keeps an explicit authorized workspace instead of rebinding to a newer current", async () => {
    const testRoot = join(tmpdir(), `ashley-m4-explicit-${randomBytes(8).toString("hex")}`);
    const sourceRoot = join(testRoot, "project");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}", "utf8");
    const manager = new WorkspaceManager({ managedRoot: join(testRoot, "workspaces") });
    const older = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    const newer = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;
    const seen: SandboxV2Request[] = [];
    const result = await executeCandidateVerificationV2({
      request: {
        projectId: "project-ashley",
        workspaceId: older.workspaceId,
        recipeId: RECIPE,
      },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      workspaceManager: manager,
      dispatcher: {
        dispatch: async (req: SandboxV2Request) => {
          seen.push(req);
          return mockReceiptResult("verified_success", older.workspaceId);
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(seen).toEqual([
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "project-ashley",
        workspaceId: older.workspaceId,
        recipeId: RECIPE,
      },
    ]);
    expect(result.license.state).toBe("succeeded");
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it("refuses a cross-project workspace without a mutation claim", async () => {
    const result = await executeCandidateVerificationV2({
      request: {
        projectId: "project-ashley",
        workspaceId: "other-project-ws",
        recipeId: RECIPE,
      },
      skipCapabilityGate: true,
      registry: verificationRegistry(),
      dispatcher: {
        dispatch: async () => ({
          outcome: "failed",
          operation: "workspace.verify",
          error: "workspace_project_mismatch",
          executedAtMs: 1,
        }),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.state).toBe("none");
    expect(result.license.error).toBe("workspace_project_mismatch");
    expect(result.license.verificationClaimEffect).toBeUndefined();
    expect(result.license.workspaceClaimEffect).toBeUndefined();
  });
});

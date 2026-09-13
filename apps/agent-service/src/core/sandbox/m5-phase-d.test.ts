import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { V2ProjectReadRegistry, type SandboxV2Dispatcher, type SandboxV2Result } from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../db.js";
import {
  capabilityCanInfluence,
  capabilityNames,
  currentBuildIdentity,
  currentContractId,
  currentReleaseId,
  graduationPolicyFor,
} from "../rollout/capabilities.js";
import { canOfferCandidateAuthorship } from "./project-registry.js";
import { executeCandidateAuthorshipV2 } from "./v2-execution.js";
import { deriveOperationalTruth } from "./operational-truth.js";
import { finalizeHonesty } from "../honesty/finalize.js";
import { candidateAuthorshipEvidenceBlock } from "../context-composer.js";
import { listChangeSetEventTypes } from "./changeset-store.js";
import type { OperationalClaimLicense } from "./engineering-types.js";

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

function authorshipRegistry(overrides: Record<string, unknown> = {}) {
  return new V2ProjectReadRegistry([
    entry({
      authorshipAllowed: true,
      ...overrides,
    }),
  ]);
}

function mockReceiptResult(): SandboxV2Result {
  const receipt = {
    kind: "changeset.author" as const,
    changesetId: "cs_" + "22".repeat(16),
    changesetVersion: 1 as const,
    projectId: "project-ashley",
    workspaceId: "ws-m5-01",
    snapshotId: "vsnap_live_1",
    sourceSnapshotId: "snap_src",
    candidateTreeHash: HASH,
    baseTreeHash: "ef".repeat(32),
    baseCommit: null,
    sourceCleanliness: "unknown" as const,
    treeHashAlgorithm: "m4-provisional-tree-v0",
    changedPaths: [
      {
        path: "src/a.ts",
        changeKind: "modified" as const,
        beforeSha256: HASH,
        afterSha256: "ab".repeat(32),
      },
    ],
    patchSha256: HASH,
    patchBytes: 32,
    artifactRef: "/tmp/sealed.patch",
    candidateUnchanged: true as const,
    liveUnwritten: true as const,
    protocolState: "admitted" as const,
    completedAtMs: 42,
  };
  return {
    outcome: "succeeded",
    operation: "changeset.author",
    result: receipt,
    executedAtMs: 42,
  };
}

const authorRequest = {
  operation: "changeset.author" as const,
  projectId: "project-ashley",
  workspaceId: "ws-m5-01",
  objective: "bound the candidate delta",
  rationale: "the workspace already holds the intended files",
  riskClass: "low" as const,
};

describe("M5 Phase D authority + truth", () => {
  it("uses operator_cutover for candidate_authorship, not live_shadow", () => {
    expect(graduationPolicyFor("candidate_authorship")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
  });

  it("disabled capability refuses offer and execute", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const registry = authorshipRegistry();
    expect(
      canOfferCandidateAuthorship(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);

    let dispatches = 0;
    const result = await executeCandidateAuthorshipV2({
      request: authorRequest,
      ownerId: "doc",
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
    expect(result.license.error).toBe("candidate_authorship_gate_denied");
    expect(result.license.authorshipClaimEffect).toBeUndefined();
    db.close();
  });

  it("unrelated engineering or verification capability does not grant M5", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, ["recall", "mind_state", "thought", "project_experimentation", "candidate_verification"]);
    expect(capabilityCanInfluence(db, "project_experimentation", "apply")).toBe(true);
    expect(capabilityCanInfluence(db, "candidate_verification", "apply")).toBe(true);
    expect(capabilityCanInfluence(db, "candidate_authorship", "apply")).toBe(false);
    const registry = authorshipRegistry();
    expect(
      canOfferCandidateAuthorship(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    const result = await executeCandidateAuthorshipV2({
      request: authorRequest,
      ownerId: "doc",
      db,
      masterMode: "apply",
      registry,
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.error).toBe("candidate_authorship_gate_denied");
    db.close();
  });

  it("capability alone does not bypass registry", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    expect(capabilityCanInfluence(db, "candidate_authorship", "apply")).toBe(true);
    const closed = new V2ProjectReadRegistry([entry({ authorshipAllowed: false })]);
    expect(
      canOfferCandidateAuthorship(db, {
        registry: closed,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    let dispatches = 0;
    const result = await executeCandidateAuthorshipV2({
      request: authorRequest,
      ownerId: "doc",
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
    expect(result.license.error).toBe("authorship_not_allowed");
    db.close();
  });

  it("authorshipAllowed=false refuses even when engineeringAllowed and verificationAllowed are true", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const registry = new V2ProjectReadRegistry([
      entry({
        engineeringAllowed: true,
        verificationAllowed: true,
        allowedRecipeIds: ["typescript_fixture_compile_v1"],
        candidateWorkspaceAllowed: true,
        authorshipAllowed: false,
      }),
    ]);
    expect(
      canOfferCandidateAuthorship(db, {
        registry,
        masterMode: "apply",
        substrateAvailable: true,
        lifecycleEnabled: true,
      }),
    ).toBe(false);
    const result = await executeCandidateAuthorshipV2({
      request: authorRequest,
      ownerId: "doc",
      db,
      masterMode: "apply",
      registry,
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.error).toBe("authorship_not_allowed");
    db.close();
  });

  it("licenses a sealed proposed change-set without apply language", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const result = await executeCandidateAuthorshipV2({
      request: { ...authorRequest, evidenceRefs: ["op_verif_01"] },
      ownerId: "doc",
      db,
      masterMode: "apply",
      registry: authorshipRegistry(),
      dispatcher: {
        dispatch: async () => mockReceiptResult(),
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(result.license.state).toBe("succeeded");
    expect(result.license.authorshipClaimEffect?.status).toBe("proposed");
    const truth = deriveOperationalTruth(result.license);
    expect(truth.state).toBe("verified_success");
    expect(truth.semanticOutput).toContain("has not been applied");
    const blob = JSON.stringify(truth).toLowerCase();
    expect(blob).not.toMatch(/merged|deployed|improved/);
    const changesetId = result.license.authorshipClaimEffect?.changesetId;
    expect(changesetId).toEqual(expect.any(String));
    const stored = db
      .prepare(
        `SELECT status, review_status, evidence_refs_json, linked_verification_refs_json, patch_sha256
           FROM candidate_changesets WHERE changeset_id = ?`,
      )
      .get(changesetId as string) as {
      status: string;
      review_status: string;
      evidence_refs_json: string;
      linked_verification_refs_json: string;
      patch_sha256: string;
    };
    expect(stored.status).toBe("proposed");
    expect(stored.review_status).toBe("submitted");
    expect(JSON.parse(stored.evidence_refs_json)).toEqual(["op_verif_01"]);
    expect(JSON.parse(stored.linked_verification_refs_json)).toEqual([]);
    expect(stored.patch_sha256).toHaveLength(64);
    expect(listChangeSetEventTypes(db, changesetId as string)).toEqual([
      "created",
      "sealed",
      "proposed",
    ]);
    db.close();
  });

  it("quarantines a credential-shaped rationale without dispatching or storing the secret", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const marker = "ghp_";
    const rationale = `token ${marker}${"A".repeat(36)}`;
    let dispatches = 0;
    const result = await executeCandidateAuthorshipV2({
      request: { ...authorRequest, rationale },
      ownerId: "doc",
      db,
      masterMode: "apply",
      registry: authorshipRegistry(),
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("secret_detected");
    const stored = db
      .prepare(
        `SELECT status, review_status, objective, rationale, quarantine_reason, patch_sha256, artifact_ref
           FROM candidate_changesets`,
      )
      .get() as {
      status: string;
      review_status: string | null;
      objective: string;
      rationale: string;
      quarantine_reason: string;
      patch_sha256: string | null;
      artifact_ref: string | null;
    };
    expect(stored.status).toBe("quarantined");
    expect(stored.review_status).toBeNull();
    expect(stored.objective).toBe("[redacted:secret_detected]");
    expect(stored.rationale).toBe("[redacted:secret_detected]");
    expect(stored.quarantine_reason).toBe("secret_detected");
    expect(stored.patch_sha256).toBeNull();
    expect(stored.artifact_ref).toBeNull();
    expect(JSON.stringify({ license: result.license, stored })).not.toContain(marker);
    db.close();
  });

  it("quarantines a credential-shaped objective without persisting the secret", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activate(db, capabilityNames);
    const marker = "ghp_";
    const objective = `token ${marker}${"B".repeat(36)}`;
    let dispatches = 0;
    const result = await executeCandidateAuthorshipV2({
      request: { ...authorRequest, objective },
      ownerId: "doc",
      db,
      masterMode: "apply",
      registry: authorshipRegistry(),
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return mockReceiptResult();
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });
    expect(dispatches).toBe(0);
    expect(result.license.error).toBe("secret_detected");
    const stored = db
      .prepare(`SELECT status, objective, rationale, patch_sha256, artifact_ref FROM candidate_changesets`)
      .get() as {
      status: string;
      objective: string;
      rationale: string;
      patch_sha256: string | null;
      artifact_ref: string | null;
    };
    expect(stored.status).toBe("quarantined");
    expect(stored.objective).toBe("[redacted:secret_detected]");
    expect(stored.rationale).toBe("[redacted:secret_detected]");
    expect(stored.patch_sha256).toBeNull();
    expect(stored.artifact_ref).toBeNull();
    const blob = JSON.stringify({ license: result.license, stored });
    expect(blob).not.toContain(marker);
    expect(blob).not.toContain(objective);
    db.close();
  });

  it("honesty inherits the licensed mechanical sentence only", () => {
    const license: OperationalClaimLicense = {
      state: "succeeded",
      profile: "candidate_authorship",
      taskId: "v2-author-1",
      authorshipClaimEffect: {
        verified: true,
        projectId: "project-ashley",
        workspaceId: "ws-m5-01",
        changesetId: "cs_" + "22".repeat(16),
        changesetVersion: 1,
        snapshotId: "vsnap_live_1",
        candidateTreeHash: HASH,
        baseTreeHash: "ef".repeat(32),
        pathCount: 1,
        patchSha256: HASH,
        status: "proposed",
        reviewStatus: "submitted",
        candidateUnchanged: true,
        liveUnwritten: true,
        protocolState: "admitted",
        completedAtMs: 1,
      },
    };
    const result = finalizeHonesty({
      text: "I applied the patch and Ashley improved herself. It should be merged.",
      readingLicensed: false,
      operationalLicense: license,
    });
    expect(result.text).toContain("has not been applied");
    expect(result.text.toLowerCase()).not.toContain("improved herself");
    expect(result.text.toLowerCase()).not.toContain("merged");
    const block = candidateAuthorshipEvidenceBlock(license, { capabilityAvailable: true });
    expect(block).toContain("authorshipStatus = proposed");
    expect(block.toLowerCase()).not.toMatch(/\bmerged\b|\bdeployed\b|improved herself/);
  });
});

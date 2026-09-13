import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import {
  capabilityCanInfluence,
  graduationPolicyFor,
  listCapabilityStatuses,
  promoteCapability,
  promotionEligible,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
  operatorRollbackCapability,
} from "./capabilities.js";
import { startDeterministicRecallEpoch } from "./recall-epoch-test-util.js";
import {
  canOfferCandidateWorkspace,
  type CanOfferProjectInspectionOptions,
} from "../sandbox/project-registry.js";
import { executeWorkspaceExperimentV2 } from "../sandbox/v2-execution.js";
import type { SandboxV2Dispatcher } from "@composer-assistant/sandbox-v2";

const releaseId = "release-test";
const start = new Date("2026-07-01T00:00:00.000Z");
const operator = "owner-1";

function qualify(
  db: DatabaseSync,
  capability: Parameters<typeof recordIsolatedEvaluation>[1],
  releaseIdOverride?: string,
): void {
  const targetRelease = releaseIdOverride ?? releaseId;
  if (capability === "recall") startDeterministicRecallEpoch(db);
  recordIsolatedEvaluation(db, capability, {
    seeds: 3,
    passed: true,
    sourceKey: `${capability}:eval`,
    releaseId: targetRelease,
    occurredAt: start.toISOString(),
  });
  for (let index = 0; index < 25; index++) {
    const at = new Date(start.getTime() + index * (7 * 86_400_000 / 24));
    recordLiveShadowEvent(db, capability, `${capability}:${index}`, {
      releaseId: targetRelease,
      occurredAt: at.toISOString(),
    });
  }
}

/** Activate the full influence chain above project_experimentation. */
function activateThoughtChain(db: DatabaseSync): void {
  qualify(db, "recall");
  expect(promoteCapability(db, "recall", { releaseId, authorizedBy: operator }).ok).toBe(true);
  qualify(db, "mind_state");
  expect(promoteCapability(db, "mind_state", { releaseId, authorizedBy: operator }).ok).toBe(true);
  qualify(db, "thought");
  expect(promoteCapability(db, "thought", { releaseId, authorizedBy: operator }).ok).toBe(true);
}

/**
 * Activate the influence chain on the CURRENT contract release, which is the
 * release `canOfferCandidateWorkspace` (and the runtime admission path) gates
 * on. Uses only the canonical recording and promotion surfaces.
 */
function activateThoughtChainOnCurrentRelease(db: DatabaseSync): void {
  const current = "ashley-capability-v3";
  startDeterministicRecallEpoch(db);
  qualify(db, "recall", current);
  expect(promoteCapability(db, "recall", { authorizedBy: operator }).ok).toBe(true);
  qualify(db, "mind_state", current);
  expect(promoteCapability(db, "mind_state", { authorizedBy: operator }).ok).toBe(true);
  qualify(db, "thought", current);
  expect(promoteCapability(db, "thought", { authorizedBy: operator }).ok).toBe(true);
  recordIsolatedEvaluation(db, "project_experimentation", {
    seeds: 3,
    passed: true,
    sourceKey: "project_experimentation:mn-eval",
    occurredAt: start.toISOString(),
  });
  expect(promoteCapability(db, "project_experimentation", { authorizedBy: operator }).ok).toBe(true);
}

function candidateRegistry(candidateWorkspaceAllowed: boolean): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([
    {
      projectId: "project-ashley",
      canonicalRoot: "/srv/projects/project-ashley",
      displayName: "Project Ashley",
      enabled: true,
      readAllowed: true,
      candidateWorkspaceAllowed,
      engineeringAllowed: false,
    },
  ]);
}

function admissionOptions(
  registry: V2ProjectReadRegistry,
): CanOfferProjectInspectionOptions {
  return {
    registry,
    lifecycleEnabled: true,
    substrateAvailable: true,
    masterMode: "apply",
  };
}

function operatorPromoteDetail(
  db: DatabaseSync,
  capability: string,
): Record<string, unknown> {
  const rows = db.prepare(
    `SELECT detail_json FROM capability_events
     WHERE capability = ? AND release_id = ? AND kind = 'operator_promote'
     ORDER BY id DESC LIMIT 1`,
  ).all(capability, releaseId) as Array<{ detail_json: string }>;
  if (rows.length === 0) throw new Error("operator_promote_event_missing");
  return JSON.parse(rows[0].detail_json) as Record<string, unknown>;
}

describe("capability graduation policy", () => {
  it("defaults every capability to the historical live-shadow policy except operator_cutover capabilities", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    for (const capability of ["recall", "mind_state", "affect", "thought", "learning", "refusal", "reading", "curiosity_consolidation", "source_discovery", "own_time_report", "project_inspection", "memory_evidence"] as const) {
      expect(graduationPolicyFor(capability)).toEqual({
        kind: "live_shadow",
        minEvalSeeds: 3,
        minLiveShadowEvents: 25,
        minLiveShadowSpanDays: 7,
        requiresQualification: true,
      });
    }
    expect(graduationPolicyFor("project_experimentation")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
    expect(graduationPolicyFor("candidate_verification")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
    expect(graduationPolicyFor("candidate_authorship")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
    expect(graduationPolicyFor("bounded_operation")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
    expect(graduationPolicyFor("patch_export")).toEqual({
      kind: "operator_cutover",
      minEvalSeeds: 3,
      requiresQualification: true,
    });
    const status = listCapabilityStatuses(db, "apply", releaseId)
      .find((s) => s.capability === "project_experimentation");
    expect(status?.graduationPolicy).toBe("operator_cutover");
    expect(
      listCapabilityStatuses(db, "apply", releaseId)
        .find((s) => s.capability === "reading")?.graduationPolicy,
    ).toBe("live_shadow");
    db.close();
  });

  it("A: live-shadow policy capability stays not_eligible with insufficient shadow evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIsolatedEvaluation(db, "reading", {
      seeds: 3,
      passed: true,
      sourceKey: "reading:eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(statusOf(db, "reading")?.evalSeedCount).toBe(3);
    expect(statusOf(db, "reading")?.qualifiedAt).not.toBeNull();
    expect(promotionEligible(db, "reading", releaseId)).toBe(false);

    for (let index = 0; index < 5; index++) {
      recordLiveShadowEvent(db, "reading", `reading:${index}`, {
        releaseId,
        occurredAt: new Date(start.getTime() + index * 86_400_000).toISOString(),
      });
    }
    expect(promotionEligible(db, "reading", releaseId)).toBe(false);
    expect(promoteCapability(db, "reading", { releaseId, authorizedBy: operator }))
      .toEqual({ ok: false, reason: "not_eligible" });

    for (let index = 5; index < 25; index++) {
      recordLiveShadowEvent(db, "reading", `reading:${index}`, {
        releaseId,
        occurredAt: new Date(start.getTime() + index * 6 * 3_600_000).toISOString(),
      });
    }
    // 25 events but a span of only six days: still below the 7-day threshold.
    expect(statusOf(db, "reading")?.liveShadowEvents).toBe(25);
    expect(promotionEligible(db, "reading", releaseId)).toBe(false);
    db.close();
  });

  it("B/C: explicit-cutover capability is eligible with qualification and no live_shadow, but not without qualification", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);

    // No qualification evidence at all -> not eligible.
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(false);
    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator }))
      .toEqual({ ok: false, reason: "not_eligible" });
    expect(statusOf(db, "project_experimentation")?.state).toBe("observe");

    // Owner-attested qualification via the canonical evaluation recording path.
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:cutover-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(statusOf(db, "project_experimentation")).toMatchObject({
      state: "observe",
      evalSeedCount: 3,
      promotionEligible: true,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
    });
    db.close();
  });

  it("D: explicit-cutover capability fails closed when a dependency is not active", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:dep-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(statusOf(db, "project_experimentation")).toMatchObject({
      dependencies: ["thought"],
      dependenciesReady: false,
    });
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(false);
    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator }))
      .toEqual({ ok: false, reason: "not_eligible" });
    db.close();
  });

  it("E: explicit-cutover promotion fails closed on a contract mismatch", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:contract-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(true);
    db.prepare("UPDATE capability_contracts SET spec_hash = ? WHERE active = 1").run("mismatch");
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(false);
    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator }))
      .toEqual({ ok: false, reason: "contract_mismatch" });
    expect(statusOf(db, "project_experimentation")?.state).toBe("observe");
    db.close();
  });

  it("F: explicit-cutover promotion fails closed without owner authorization", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:auth-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(true);
    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: "" }))
      .toEqual({ ok: false, reason: "authorization_required" });
    expect(statusOf(db, "project_experimentation")?.state).toBe("observe");
    const events = db.prepare(
      `SELECT COUNT(*) AS c FROM capability_events
       WHERE capability = 'project_experimentation' AND kind = 'operator_promote'`,
    ).get() as { c: number };
    expect(events.c).toBe(0);
    db.close();
  });

  it("G: live-shadow-only capability cannot graduate through cutover semantics", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIsolatedEvaluation(db, "reading", {
      seeds: 3,
      passed: true,
      sourceKey: "reading:eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    // Even with qualification evidence, a live-shadow-policy capability has no
    // operator-cutover path: promotion remains blocked without shadow volume.
    expect(graduationPolicyFor("reading").kind).toBe("live_shadow");
    expect(promotionEligible(db, "reading", releaseId)).toBe(false);
    expect(promoteCapability(db, "reading", { releaseId, authorizedBy: operator }))
      .toEqual({ ok: false, reason: "not_eligible" });
    expect(statusOf(db, "reading")?.state).toBe("observe");
    db.close();
  });

  it("H/I: explicit cutover transitions observe -> active and records a distinguishable durable audit", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:h-audit",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(promotionEligible(db, "project_experimentation", releaseId)).toBe(true);

    const result = promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator });
    expect(result).toEqual({ ok: true, state: "active" });
    expect(statusOf(db, "project_experimentation")?.state).toBe("active");

    const detail = operatorPromoteDetail(db, "project_experimentation");
    expect(detail).toMatchObject({
      authorizedBy: operator,
      promotionPath: "operator_cutover",
    });

    // A live-shadow promotion records the distinct promotion path.
    qualify(db, "reading");
    promoteCapability(db, "reading", { releaseId, authorizedBy: operator });
    expect(operatorPromoteDetail(db, "reading")).toMatchObject({
      authorizedBy: operator,
      promotionPath: "live_shadow",
    });

    // The two promotion paths are forensically distinguishable.
    const paths = db.prepare(
      `SELECT detail_json FROM capability_events WHERE kind = 'operator_promote'`,
    ).all() as Array<{ detail_json: string }>;
    const recorded = paths.map((row) => JSON.parse(row.detail_json) as { promotionPath?: string });
    expect(recorded.some((r) => r.promotionPath === "operator_cutover")).toBe(true);
    expect(recorded.some((r) => r.promotionPath === "live_shadow")).toBe(true);
    db.close();
  });

  it("J: explicitly cut-over capability rolls back through the canonical rollback path", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:j-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator }).ok).toBe(true);
    expect(statusOf(db, "project_experimentation")?.state).toBe("active");

    const rolled = operatorRollbackCapability(db, "project_experimentation", {
      releaseId,
      authorizedBy: operator,
    });
    expect(rolled).toMatchObject({ success: true, status: "rolled_back" });
    expect(statusOf(db, "project_experimentation")?.state).toBe("rolled_back");
    expect(capabilityCanInfluence(db, "project_experimentation", "apply", releaseId)).toBe(false);
    const audit = db.prepare(
      `SELECT COUNT(*) AS c FROM capability_events
       WHERE capability = 'project_experimentation' AND kind = 'operator_rollback'`,
    ).get() as { c: number };
    expect(audit.c).toBe(1);
    db.close();
  });

  it("K: observe-state project_experimentation offers no candidate workspace and executes no M3", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    let dispatched = 0;
    const dispatcher = {
      dispatch: async () => {
        dispatched++;
        return { outcome: "failed", operation: "workspace.write_file", error: "unexpected", executedAtMs: Date.now() };
      },
    } as unknown as SandboxV2Dispatcher;

    expect(canOfferCandidateWorkspace(db, admissionOptions(candidateRegistry(true)))).toBe(false);

    const res = await executeWorkspaceExperimentV2({
      request: {
        operation: "workspace.write_file",
        projectId: "project-ashley",
        path: "witness.txt",
        workspaceId: "ws-test",
        content: "m3-production-ok",
      } as any,
      db,
      masterMode: "apply",
      dispatcher,
      registry: candidateRegistry(true),
      envOverrides: {
        sandboxEngineeringLifecycleEnabled: true,
        sandboxAvailable: () => true,
      },
    });
    expect(res.license).toMatchObject({
      state: "none",
      profile: "project_experimentation",
      error: "project_experimentation_gate_denied",
    });
    expect(res.license.workspaceClaimEffect).toBeUndefined();
    expect(res.observation).toBeNull();
    expect(dispatched).toBe(0);
    db.close();
  });

  it("L: after a valid explicit cutover, influence is granted without any fake live_shadow evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChain(db);
    recordIsolatedEvaluation(db, "project_experimentation", {
      seeds: 3,
      passed: true,
      sourceKey: "project_experimentation:l-eval",
      releaseId,
      occurredAt: start.toISOString(),
    });
    expect(statusOf(db, "project_experimentation")?.liveShadowEvents).toBe(0);
    expect(capabilityCanInfluence(db, "project_experimentation", "apply", releaseId)).toBe(false);

    expect(promoteCapability(db, "project_experimentation", { releaseId, authorizedBy: operator }).ok).toBe(true);
    expect(capabilityCanInfluence(db, "project_experimentation", "apply", releaseId)).toBe(true);
    expect(capabilityCanInfluence(db, "project_experimentation", "observe", releaseId)).toBe(false);
    expect(statusOf(db, "project_experimentation")).toMatchObject({
      state: "active",
      effective: true,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
    });
    db.close();
  });

  it("M/N: project-level candidateWorkspaceAllowed and engineeringAllowed remain distinct independent gates", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateThoughtChainOnCurrentRelease(db);
    expect(capabilityCanInfluence(db, "project_experimentation", "apply")).toBe(true);

    // Capability active but candidateWorkspaceAllowed=false: admission denied.
    const deniedRegistry = candidateRegistry(false);
    expect(deniedRegistry.list()[0].engineeringAllowed).toBe(false);
    expect(canOfferCandidateWorkspace(db, admissionOptions(deniedRegistry))).toBe(false);

    // Capability active and candidateWorkspaceAllowed=true: admission may succeed.
    expect(canOfferCandidateWorkspace(db, admissionOptions(candidateRegistry(true)))).toBe(true);

    // engineeringAllowed=true alone never widens candidate-workspace admission.
    const engineeringOnly = new V2ProjectReadRegistry([
      {
        projectId: "project-ashley",
        canonicalRoot: "/srv/projects/project-ashley",
        displayName: "Project Ashley",
        enabled: true,
        readAllowed: true,
        candidateWorkspaceAllowed: false,
        engineeringAllowed: true,
      },
    ]);
    expect(canOfferCandidateWorkspace(db, admissionOptions(engineeringOnly))).toBe(false);
    db.close();
  });
});

function statusOf(db: DatabaseSync, capability: Parameters<typeof recordIsolatedEvaluation>[1]) {
  return listCapabilityStatuses(db, "apply", releaseId)
    .find((status) => status.capability === capability);
}

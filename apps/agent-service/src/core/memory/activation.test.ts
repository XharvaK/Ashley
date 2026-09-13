import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getMemoryContractState } from "./contract-state.js";
import {
  cutoverMemoryAssertions,
} from "./cutover.js";
import {
  currentBuildIdentity,
  currentContractId,
  promoteCapability,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
  recordRecallLiveCutover,
  operatorRollbackCapability,
} from "../rollout/capabilities.js";
import { startDeterministicRecallEpoch } from "../rollout/recall-epoch-test-util.js";
import {
  C1_EVALUATION_DEFINITION_HASH,
  C1_EVALUATION_DEFINITION_ID,
  C1_EVALUATION_DEFINITION_VERSION,
  C1_REQUIRED_EVAL_SEEDS,
  recordMemoryEvidenceIsolatedEvaluation,
  recordMemoryEvidenceLiveShadow,
  startMemoryEvidenceQualificationEpoch,
} from "../rollout/memory-evidence-qualification-epoch.js";
import {
  executeMemoryEvidenceCutover,
  getMemoryEvidenceCutoverReadiness,
} from "./activation.js";

const OWNER = "owner:test";
const RELEASE_ID = currentContractId();
const START = new Date("2026-08-01T00:00:00.000Z");

function openDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function qualifyRecallAndRecordCutoff(db: DatabaseSync): void {
  startDeterministicRecallEpoch(db, `activation-recall:${OWNER}`);
  recordIsolatedEvaluation(db, "recall", {
    releaseId: RELEASE_ID,
    seeds: 3,
    passed: true,
    sourceKey: `activation-recall:${OWNER}:eval`,
    occurredAt: START.toISOString(),
  });
  for (let index = 0; index < 25; index += 1) {
    recordLiveShadowEvent(db, "recall", `activation-recall:${OWNER}:shadow:${index}`, {
      releaseId: RELEASE_ID,
      occurredAt: new Date(START.getTime() + index * (7 * 86_400_000 / 24)).toISOString(),
    });
  }
  expect(promoteCapability(db, "recall", {
    releaseId: RELEASE_ID,
    authorizedBy: OWNER,
  })).toMatchObject({ ok: true, state: "active" });
  expect(recordRecallLiveCutover(db, OWNER, {
    authorizedBy: OWNER,
    masterMode: "observe",
  })).toMatchObject({ success: true });
}

function fullyQualifyC1(db: DatabaseSync): string {
  qualifyRecallAndRecordCutoff(db);
  const started = startMemoryEvidenceQualificationEpoch(db, {
    ownerId: OWNER,
    startRequestKey: "activation-c1:start",
    predecessorEpochId: null,
  }, START);
  expect(started).toMatchObject({ ok: true, created: true });
  if (!started.ok) throw new Error("activation_c1_epoch_setup_failed");

  expect(recordMemoryEvidenceIsolatedEvaluation(db, {
    ownerId: OWNER,
    sourceKey: `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:activation-run`,
    definitionId: C1_EVALUATION_DEFINITION_ID,
    definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
    definitionHash: C1_EVALUATION_DEFINITION_HASH,
    seeds: C1_REQUIRED_EVAL_SEEDS.map((id) => ({ id, passed: true })),
  }, START)).toEqual({ recorded: true });

  for (let index = 0; index < 24; index += 1) {
    expect(recordMemoryEvidenceLiveShadow(db, {
      ownerId: OWNER,
      sourceKey: `c1-shadow:v1:decision:${index + 1}`,
      decisionClass: "same_current",
      qualifies: true,
      trigger: "reactive",
      sourceCount: 1,
      detail: { decisionId: String(index + 1) },
      occurredAt: new Date(START.getTime() + index * (7 * 86_400_000 / 24)).toISOString(),
    })).toEqual({ recorded: true });
  }
  expect(recordMemoryEvidenceLiveShadow(db, {
    ownerId: OWNER,
    sourceKey: "c1-shadow:v1:decision:25",
    decisionClass: "would_narrow",
    qualifies: true,
    trigger: "proactive",
    sourceCount: 1,
    detail: { decisionId: "25" },
    occurredAt: new Date(START.getTime() + 7 * 86_400_000).toISOString(),
  })).toEqual({ recorded: true });
  return started.epochId;
}

function promoteC1(db: DatabaseSync, epochId: string): void {
  expect(promoteCapability(db, "memory_evidence", {
    releaseId: RELEASE_ID,
    authorizedBy: OWNER,
  })).toMatchObject({ ok: true, state: "active" });
  expect(db.prepare(
    `SELECT sealed_at, sealed_release_id FROM memory_evidence_qualification_epochs
     WHERE epoch_id = ?`,
  ).get(epochId)).toMatchObject({ sealed_release_id: RELEASE_ID });
}

function cutoverInput(epochId: string, overrides: Partial<{
  masterMode: "observe" | "apply";
  expressionPlanePaused: boolean;
  ownerExpressionActive: boolean;
}> = {}) {
  return {
    ownerId: OWNER,
    epochId,
    masterMode: overrides.masterMode ?? "observe",
    expressionPlanePaused: overrides.expressionPlanePaused ?? true,
    ownerExpressionActive: overrides.ownerExpressionActive ?? false,
  } as const;
}

describe("C1 guarded activation", () => {
  it("reports every missing activation and qualification gate", () => {
    const db = openDb();
    try {
      const readiness = getMemoryEvidenceCutoverReadiness(db, {
        ...cutoverInput("missing-epoch", {
          masterMode: "apply",
          expressionPlanePaused: false,
          ownerExpressionActive: true,
        }),
      });
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockerCodes).toEqual(expect.arrayContaining([
        "no_current_epoch",
        "master_mode_not_observe",
        "expression_plane_not_paused",
        "owner_expression_active",
        "memory_evidence_not_active",
        "recall_not_active",
        "recall_cutoff_missing",
        "live_shadow_count_insufficient",
      ]));
      expect(readiness.preCutoverConsistency.ok).toBe(true);
      expect(readiness.blockingEventCount).toBe(0);
    } finally {
      db.close();
    }
  });

  it("requires trusted quiescence and an exact sealed active epoch", () => {
    const db = openDb();
    try {
      const epochId = fullyQualifyC1(db);
      let readiness = getMemoryEvidenceCutoverReadiness(db, cutoverInput(epochId));
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockerCodes).toEqual(expect.arrayContaining([
        "memory_evidence_not_active",
        "epoch_not_sealed",
      ]));

      promoteC1(db, epochId);
      readiness = getMemoryEvidenceCutoverReadiness(db, cutoverInput(epochId, {
        masterMode: "apply",
        expressionPlanePaused: false,
        ownerExpressionActive: true,
      }));
      expect(readiness.eligible).toBe(false);
      expect(readiness.blockerCodes).toEqual(expect.arrayContaining([
        "master_mode_not_observe",
        "expression_plane_not_paused",
        "owner_expression_active",
      ]));

      readiness = getMemoryEvidenceCutoverReadiness(db, cutoverInput(epochId));
      expect(readiness).toMatchObject({
        eligible: true,
        epochId,
        epochBuildIdentity: currentBuildIdentity(),
        epochContractId: RELEASE_ID,
        memoryEvidenceState: "active",
        currentnessAuthority: "mem_facts",
        preCutoverConsistency: { ok: true },
      });
    } finally {
      db.close();
    }
  });

  it("executes the existing atomic cutover once and verifies it idempotently", () => {
    const db = openDb();
    try {
      const epochId = fullyQualifyC1(db);
      promoteC1(db, epochId);
      const first = executeMemoryEvidenceCutover(db, cutoverInput(epochId));
      expect(first).toMatchObject({
        ok: true,
        alreadyCutOver: false,
        epochId,
        releaseId: RELEASE_ID,
        buildIdentity: currentBuildIdentity(),
        contractId: RELEASE_ID,
        markerBefore: { currentnessAuthority: "mem_facts" },
        markerAfter: { currentnessAuthority: "memory_assertions" },
        consistencyBefore: { ok: true },
        consistencyAfter: { ok: true },
        stickyRollbackDiagnostics: {
          reverseCutoverAvailable: false,
          barriersRemainEnforced: true,
        },
      });
      expect(getMemoryContractState(db)?.currentnessAuthority).toBe("memory_assertions");

      const retry = executeMemoryEvidenceCutover(db, cutoverInput(epochId));
      expect(retry).toMatchObject({
        ok: true,
        alreadyCutOver: true,
        markerBefore: { currentnessAuthority: "memory_assertions" },
        markerAfter: { currentnessAuthority: "memory_assertions" },
        consistencyBefore: { ok: true },
        consistencyAfter: { ok: true },
      });
      expect(db.prepare(
        `SELECT currentness_authority, cutover_at FROM memory_contract_state WHERE id = 1`,
      ).get()).toMatchObject({ currentness_authority: "memory_assertions" });
    } finally {
      db.close();
    }
  });

  it("keeps sticky assertions currentness and barriers after capability rollback", () => {
    const db = openDb();
    try {
      const epochId = fullyQualifyC1(db);
      promoteC1(db, epochId);
      expect(executeMemoryEvidenceCutover(db, cutoverInput(epochId))).toMatchObject({ ok: true });
      expect(operatorRollbackCapability(db, "memory_evidence", { authorizedBy: OWNER })).toMatchObject({
        success: true,
        status: "rolled_back",
      });
      expect(getMemoryContractState(db)).toMatchObject({
        currentnessAuthority: "memory_assertions",
      });
      expect(cutoverMemoryAssertions(db)).toMatchObject({
        marker: { currentnessAuthority: "memory_assertions" },
      });
    } finally {
      db.close();
    }
  });
});

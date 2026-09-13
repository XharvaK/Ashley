import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
  listCapabilityStatuses,
  promoteCapability,
  promotionEligible,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
  recordRecallLiveCutover,
} from "./capabilities.js";
import { startDeterministicRecallEpoch } from "./recall-epoch-test-util.js";
import {
  C1_EVALUATION_DEFINITION_HASH,
  C1_EVALUATION_DEFINITION_ID,
  C1_EVALUATION_DEFINITION_VERSION,
  C1_REQUIRED_EVAL_SEEDS,
  getCurrentMemoryEvidenceQualificationEpoch,
  getMemoryEvidenceQualificationReadiness,
  listMemoryEvidenceQualificationEpochs,
  recordMemoryEvidenceIsolatedEvaluation,
  recordMemoryEvidenceLiveShadow,
  startMemoryEvidenceQualificationEpoch,
} from "./memory-evidence-qualification-epoch.js";

const OWNER = "doc";
const OTHER_OWNER = "other-owner";
const RELEASE_ID = currentContractId();
const START = new Date("2026-08-01T00:00:00.000Z");

function openDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function qualifyRecallAndRecordCutoff(
  db: DatabaseSync,
  ownerId = OWNER,
  recordCutoff = true,
): void {
  startDeterministicRecallEpoch(db, `c1-recall:${ownerId}`);
  recordIsolatedEvaluation(db, "recall", {
    releaseId: RELEASE_ID,
    seeds: 3,
    passed: true,
    sourceKey: `c1-recall:${ownerId}:eval`,
    occurredAt: START.toISOString(),
  });
  for (let index = 0; index < 25; index += 1) {
    recordLiveShadowEvent(db, "recall", `c1-recall:${ownerId}:shadow:${index}`, {
      releaseId: RELEASE_ID,
      occurredAt: new Date(START.getTime() + index * (7 * 86_400_000 / 24)).toISOString(),
    });
  }
  expect(promoteCapability(db, "recall", {
    releaseId: RELEASE_ID,
    authorizedBy: ownerId,
  })).toMatchObject({ ok: true, state: "active" });
  if (recordCutoff) {
    expect(recordRecallLiveCutover(db, ownerId, {
      authorizedBy: ownerId,
      masterMode: "observe",
    })).toMatchObject({ success: true });
  }
}

function startC1(
  db: DatabaseSync,
  ownerId = OWNER,
  requestKey = `c1-start:${ownerId}`,
): string {
  const result = startMemoryEvidenceQualificationEpoch(db, {
    ownerId,
    startRequestKey: requestKey,
    predecessorEpochId: null,
  }, START);
  expect(result).toMatchObject({ ok: true, created: true });
  if (!result.ok) throw new Error("c1_epoch_test_setup_failed");
  return result.epochId;
}

function evaluationInput(
  ownerId = OWNER,
  sourceKey = `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:run-1`,
  seeds = C1_REQUIRED_EVAL_SEEDS.map((id) => ({ id, passed: true })),
) {
  return {
    ownerId,
    sourceKey,
    definitionId: C1_EVALUATION_DEFINITION_ID,
    definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
    definitionHash: C1_EVALUATION_DEFINITION_HASH,
    seeds,
  } as const;
}

function shadowInput(input: {
  ownerId?: string;
  sourceKey?: string;
  trigger?: "reactive" | "proactive";
  decisionClass?: "no_c1_material" | "same_current" | "would_relabel" | "would_filter" | "would_narrow" | "mixed_change" | "unmapped_fail_closed" | "evaluation_error";
  qualifies?: boolean;
  sourceCount?: number;
  detail?: Record<string, unknown>;
  occurredAt?: string;
} = {}) {
  return {
    ownerId: input.ownerId ?? OWNER,
    sourceKey: input.sourceKey ?? "c1-shadow:v1:decision:1",
    trigger: input.trigger ?? "reactive",
    decisionClass: input.decisionClass ?? "same_current",
    qualifies: input.qualifies ?? true,
    sourceCount: input.sourceCount ?? 1,
    detail: input.detail ?? { decisionId: "1" },
    occurredAt: input.occurredAt,
  };
}

function recordQualifyingShadows(
  db: DatabaseSync,
  count: number,
  options: { trigger?: "reactive" | "proactive"; start?: Date; prefix?: string } = {},
): void {
  const trigger = options.trigger ?? "reactive";
  const start = options.start ?? START;
  const prefix = options.prefix ?? `${trigger}`;
  const prefixNumber = [...prefix].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 1_000_000,
    1,
  );
  for (let index = 0; index < count; index += 1) {
    const at = new Date(start.getTime() + index * (7 * 86_400_000 / Math.max(1, count - 1)));
    expect(recordMemoryEvidenceLiveShadow(db, shadowInput({
      sourceKey: `c1-shadow:v1:decision:${prefixNumber * 1000 + index + 1}`,
      trigger,
      occurredAt: at.toISOString(),
    }), at)).toEqual({ recorded: true });
  }
}

function fullyQualifyC1(db: DatabaseSync): string {
  qualifyRecallAndRecordCutoff(db);
  const epochId = startC1(db);
  expect(recordMemoryEvidenceIsolatedEvaluation(db, evaluationInput(), START))
    .toEqual({ recorded: true });
  recordQualifyingShadows(db, 24, { trigger: "reactive", prefix: "reactive" });
  recordQualifyingShadows(db, 1, {
    trigger: "proactive",
    start: new Date(START.getTime() + 7 * 86_400_000),
    prefix: "proactive",
  });
  return epochId;
}

function countRows(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c);
}

describe("C1 memory evidence qualification epochs", () => {
  it("does not create an implicit epoch", () => {
    const db = openDb();
    try {
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toBeNull();
      expect(recordMemoryEvidenceIsolatedEvaluation(db, evaluationInput()))
        .toEqual({ recorded: false, reason: "no_current_epoch" });
      expect(recordMemoryEvidenceLiveShadow(db, shadowInput()))
        .toEqual({ recorded: false, reason: "no_current_epoch" });
      expect(countRows(db, "memory_evidence_qualification_epochs")).toBe(0);
      expect(countRows(db, "memory_evidence_qualification_events")).toBe(0);
    } finally {
      db.close();
    }
  });

  it("starts only with mem_facts, C1 observe, active Recall, an owner cutoff, and current bindings", () => {
    const db = openDb();
    try {
      expect(startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "gated:no-recall",
        predecessorEpochId: null,
      }, START)).toEqual({ ok: false, reason: "recall_not_active", currentEpochId: null });

      qualifyRecallAndRecordCutoff(db, OWNER, false);
      expect(startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "gated:no-cutoff",
        predecessorEpochId: null,
      }, START)).toEqual({ ok: false, reason: "recall_cutoff_missing", currentEpochId: null });

      expect(recordRecallLiveCutover(db, OWNER, {
        authorizedBy: OWNER,
        masterMode: "observe",
      })).toMatchObject({ success: true });
      const result = startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "gated:success",
        predecessorEpochId: null,
      }, START);
      expect(result).toMatchObject({ ok: true, created: true });
      if (result.ok) {
        expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
          epochId: result.epochId,
          ownerId: OWNER,
          contractId: RELEASE_ID,
          startedBuildIdentity: currentBuildIdentity(),
          evalSeedCount: 0,
          qualifiedAt: null,
        });
      }
    } finally {
      db.close();
    }
  });

  it("is idempotent by start request key and lists only durable epochs", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      const first = startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "same-start",
        predecessorEpochId: null,
      }, START);
      expect(first).toMatchObject({ ok: true, created: true });
      if (!first.ok) return;
      const retry = startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "same-start",
        predecessorEpochId: null,
      }, new Date(START.getTime() + 1000));
      expect(retry).toEqual({
        ok: true,
        created: false,
        epochId: first.epochId,
        predecessorEpochId: null,
        startedAt: first.startedAt,
      });
      expect(listMemoryEvidenceQualificationEpochs(db, OWNER)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("requires the exact predecessor and retires the predecessor atomically", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      const first = startC1(db, OWNER, "epoch:first");
      const second = startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "epoch:second",
        predecessorEpochId: first,
      }, new Date(START.getTime() + 1000));
      expect(second).toMatchObject({ ok: true, created: true, predecessorEpochId: first });
      if (!second.ok) return;
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)?.epochId).toBe(second.epochId);
      expect(listMemoryEvidenceQualificationEpochs(db, OWNER)).toEqual([
        expect.objectContaining({ epochId: first, status: "retired", retiredAt: expect.any(String) }),
        expect.objectContaining({ epochId: second.epochId, status: "current", predecessorEpochId: first }),
      ]);
      expect(startMemoryEvidenceQualificationEpoch(db, {
        ownerId: OWNER,
        startRequestKey: "epoch:stale",
        predecessorEpochId: first,
      }, new Date(START.getTime() + 2000))).toEqual({
        ok: false,
        reason: "epoch_changed",
        currentEpochId: second.epochId,
      });
    } finally {
      db.close();
    }
  });

  it("fails closed for cross-owner, build-drift, contract-drift, and stale-predecessor writes", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      const epochId = startC1(db);
      expect(recordMemoryEvidenceLiveShadow(db, shadowInput({ ownerId: OTHER_OWNER })))
        .toEqual({ recorded: false, reason: "epoch_owner_mismatch" });

      db.prepare(
        `UPDATE memory_evidence_qualification_epochs SET started_build_identity = ? WHERE epoch_id = ?`,
      ).run("different-build", epochId);
      expect(recordMemoryEvidenceLiveShadow(db, shadowInput({ sourceKey: "c1-shadow:v1:decision:1001" })))
        .toEqual({ recorded: false, reason: "build_identity_mismatch" });

      const contractDb = openDb();
      try {
        qualifyRecallAndRecordCutoff(contractDb);
        const contractEpoch = startC1(contractDb, OWNER, "contract-epoch");
        contractDb.prepare(
          `UPDATE memory_evidence_qualification_epochs SET contract_id = ? WHERE epoch_id = ?`,
        ).run("different-contract", contractEpoch);
        expect(recordMemoryEvidenceLiveShadow(contractDb, shadowInput({ sourceKey: "c1-shadow:v1:decision:1002" })))
          .toEqual({ recorded: false, reason: "contract_identity_mismatch" });
      } finally {
        contractDb.close();
      }

      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
        blockedAt: expect.any(String),
        blockCode: "build_identity_mismatch",
        blockSourceKey: "c1-shadow:v1:decision:1001",
      });
    } finally {
      db.close();
    }
  });

  it("makes a same-receipt replay idempotent and blocks a different receipt without overwriting", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      const epochId = startC1(db);
      const first = recordMemoryEvidenceLiveShadow(db, shadowInput());
      const retry = recordMemoryEvidenceLiveShadow(db, shadowInput());
      expect(first).toEqual({ recorded: true });
      expect(retry).toEqual({ recorded: false, reason: "idempotent" });
      const collision = recordMemoryEvidenceLiveShadow(db, shadowInput({
        detail: { decisionId: "1", different: true },
      }));
      expect(collision).toEqual({ recorded: false, reason: "source_key_collision" });
      expect(countRows(db, "memory_evidence_qualification_events")).toBe(1);
      expect(db.prepare(
        `SELECT detail_json FROM memory_evidence_qualification_events
         WHERE epoch_id = ? AND source_key = 'c1-shadow:v1:decision:1'`,
      ).get(epochId)).toMatchObject({ detail_json: JSON.stringify({ decisionId: "1" }) });
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
        blockedAt: expect.any(String),
        blockCode: "source_key_collision",
        blockSourceKey: "c1-shadow:v1:decision:1",
      });
    } finally {
      db.close();
    }
  });

  it("rejects generic C1 evaluation and live-shadow recording", () => {
    const db = openDb();
    try {
      expect(() => recordIsolatedEvaluation(db, "memory_evidence", {
        seeds: 6,
        passed: true,
        sourceKey: "generic-c1-eval",
      })).toThrow("memory_evidence_requires_bound_evaluation");
      expect(() => recordLiveShadowEvent(db, "memory_evidence", "generic-c1-shadow"))
        .toThrow("memory_evidence_requires_semantic_witness");
    } finally {
      db.close();
    }
  });

  it("requires exactly one complete passing run of all six bound evaluation seeds", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      const epochId = startC1(db);
      const partial = evaluationInput(
        OWNER,
        `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:partial`,
        C1_REQUIRED_EVAL_SEEDS.slice(0, 5).map((id) => ({ id, passed: true })),
      );
      expect(recordMemoryEvidenceIsolatedEvaluation(db, partial))
        .toEqual({ recorded: false, reason: "required_eval_seeds_incomplete" });
      const unknown = evaluationInput(
        OWNER,
        `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:unknown`,
        [...C1_REQUIRED_EVAL_SEEDS.slice(0, 5), "unknown_seed"].map((id) => ({ id, passed: true })) as never,
      );
      expect(recordMemoryEvidenceIsolatedEvaluation(db, unknown))
        .toEqual({ recorded: false, reason: "evaluation_definition_mismatch" });
      const failed = evaluationInput(
        OWNER,
        `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:failed`,
        C1_REQUIRED_EVAL_SEEDS.map((id, index) => ({ id, passed: index !== 2 })),
      );
      expect(recordMemoryEvidenceIsolatedEvaluation(db, failed)).toEqual({ recorded: true });
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
        epochId,
        evalSeedCount: 6,
        qualifiedAt: null,
      });
      const passing = evaluationInput(
        OWNER,
        `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:passing`,
      );
      expect(recordMemoryEvidenceIsolatedEvaluation(db, passing)).toEqual({ recorded: true });
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
        evalSeedCount: 6,
        qualifiedAt: expect.any(String),
      });
    } finally {
      db.close();
    }
  });

  it("ignores manufactured legacy generic capability evidence for C1 promotion", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      startC1(db);
      db.prepare(
        `INSERT OR IGNORE INTO capability_releases
          (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
         VALUES ('memory_evidence', ?, 'observe', ?, ?, ?, 0)`,
      ).run(RELEASE_ID, START.toISOString(), RELEASE_ID, currentBuildIdentity());
      db.prepare(
        `UPDATE capability_releases SET eval_seed_count = 6, qualified_at = ?
         WHERE capability = 'memory_evidence' AND release_id = ?`,
      ).run(START.toISOString(), RELEASE_ID);
      for (let index = 0; index < 25; index += 1) {
        db.prepare(
          `INSERT INTO capability_events
             (capability, release_id, kind, source_key, detail_json, occurred_at,
              contract_id, build_identity, model_epoch)
           VALUES ('memory_evidence', ?, 'live_shadow', ?, '{}', ?, ?, ?, 0)`,
        ).run(
          RELEASE_ID,
          `legacy:c1:${index}`,
          new Date(START.getTime() + index * (7 * 86_400_000 / 24)).toISOString(),
          RELEASE_ID,
          currentBuildIdentity(),
        );
      }
      expect(promotionEligible(db, "memory_evidence", RELEASE_ID)).toBe(false);
      expect(listCapabilityStatuses(db, "apply", RELEASE_ID).find(
        (status) => status.capability === "memory_evidence",
      )).toMatchObject({
        evalSeedCount: 0,
        liveShadowEvents: 0,
        promotionEligible: false,
      });
    } finally {
      db.close();
    }
  });

  it("uses dedicated readiness with count, span, both triggers, and blocker gates", () => {
    const db = openDb();
    try {
      qualifyRecallAndRecordCutoff(db);
      startC1(db);
      expect(recordMemoryEvidenceIsolatedEvaluation(db, evaluationInput(), START))
        .toEqual({ recorded: true });
      expect(recordMemoryEvidenceLiveShadow(db, shadowInput({
        sourceKey: "c1-shadow:v1:decision:2001",
        decisionClass: "no_c1_material",
        qualifies: false,
        sourceCount: 0,
      }), START)).toEqual({ recorded: true });
      recordQualifyingShadows(db, 24, { trigger: "reactive", prefix: "threshold-reactive" });
      let readiness = getMemoryEvidenceQualificationReadiness(db, OWNER, new Date(START.getTime() + 7 * 86_400_000));
      expect(readiness).toMatchObject({
        eligible: false,
        observedCount: 25,
        qualifyingCount: 24,
        nonQualifyingCount: 1,
        blockerCodes: ["live_shadow_count_insufficient", "proactive_witness_missing"],
      });

      recordQualifyingShadows(db, 1, {
        trigger: "reactive",
        start: new Date(START.getTime() + 7 * 86_400_000),
        prefix: "threshold-reactive-last",
      });
      readiness = getMemoryEvidenceQualificationReadiness(db, OWNER, new Date(START.getTime() + 7 * 86_400_000));
      expect(readiness.blockerCodes).toContain("proactive_witness_missing");
      expect(readiness.eligible).toBe(false);

      expect(recordMemoryEvidenceLiveShadow(db, shadowInput({
        sourceKey: "c1-shadow:v1:decision:2002",
        trigger: "proactive",
        occurredAt: new Date(START.getTime() + 7 * 86_400_000).toISOString(),
      }), new Date(START.getTime() + 7 * 86_400_000))).toEqual({ recorded: true });
      readiness = getMemoryEvidenceQualificationReadiness(db, OWNER, new Date(START.getTime() + 7 * 86_400_000));
      expect(readiness).toMatchObject({
        eligible: true,
        observedCount: 27,
        qualifyingCount: 26,
        nonQualifyingCount: 1,
        spanDays: 7,
        countsByTrigger: { reactive: 26, proactive: 1 },
        countsByDecisionClass: { same_current: 26 },
        blockingEventCount: 0,
        currentnessAuthority: "mem_facts",
        recallState: "active",
        recallCutoffPresent: true,
      });
    } finally {
      db.close();
    }
  });

  it("atomically seals the exact epoch, activates the release, and audits promotion", () => {
    const injections = [
      {
        name: "epoch",
        ddl: `CREATE TRIGGER c1_promotion_failure BEFORE UPDATE OF sealed_at ON memory_evidence_qualification_epochs
              BEGIN SELECT RAISE(ABORT, 'injected:c1-epoch'); END;`,
      },
      {
        name: "release",
        ddl: `CREATE TRIGGER c1_promotion_failure BEFORE UPDATE OF state ON capability_releases
              WHEN NEW.capability = 'memory_evidence'
              BEGIN SELECT RAISE(ABORT, 'injected:c1-release'); END;`,
      },
      {
        name: "audit",
        ddl: `CREATE TRIGGER c1_promotion_failure BEFORE INSERT ON capability_events
              WHEN NEW.capability = 'memory_evidence'
              BEGIN SELECT RAISE(ABORT, 'injected:c1-audit'); END;`,
      },
    ];
    for (const injection of injections) {
      const db = openDb();
      try {
        const epochId = fullyQualifyC1(db);
        db.exec(injection.ddl);
        expect(() => promoteCapability(db, "memory_evidence", {
          releaseId: RELEASE_ID,
          authorizedBy: OWNER,
        })).toThrow(/injected:c1-/);
        expect(db.prepare(
          `SELECT state FROM capability_releases
           WHERE capability = 'memory_evidence' AND release_id = ?`,
        ).get(RELEASE_ID)).toEqual({ state: "observe" });
        expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
          epochId,
          sealedAt: null,
          sealedReleaseId: null,
        });
        expect(db.prepare(
          `SELECT COUNT(*) AS c FROM capability_events
           WHERE capability = 'memory_evidence' AND kind = 'operator_promote'`,
        ).get()).toEqual({ c: 0 });
      } finally {
        db.close();
      }
    }
  });

  it("returns epoch_sealed after promotion and keeps promotion separate from currentness", () => {
    const db = openDb();
    try {
      const epochId = fullyQualifyC1(db);
      expect(promoteCapability(db, "memory_evidence", {
        releaseId: RELEASE_ID,
        authorizedBy: OWNER,
      })).toEqual({ ok: true, state: "active" });
      expect(getCurrentMemoryEvidenceQualificationEpoch(db, OWNER)).toMatchObject({
        epochId,
        status: "current",
        sealedAt: expect.any(String),
        sealedReleaseId: RELEASE_ID,
      });
      expect(db.prepare(
        `SELECT currentness_authority FROM memory_contract_state WHERE id = 1`,
      ).get()).toEqual({ currentness_authority: "mem_facts" });
      expect(recordMemoryEvidenceLiveShadow(db, shadowInput({
        sourceKey: "c1-shadow:v1:decision:3001",
      }))).toEqual({ recorded: false, reason: "epoch_sealed" });
    } finally {
      db.close();
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../errors.js";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  applyModelContinuity,
  resolveProviderModelId,
} from "./continuity.js";
import {
  foldAttentionDailyUsage,
  monthlyUsageSummary,
} from "./daily.js";
import { declaredContractHash } from "./contract-material.js";
import { runAttentiveDispatch } from "./governor.js";
import {
  completeRequest,
  contractMismatch,
  currentTpmUsage,
  ensureBootstrapContract,
  getRequest,
  insertQueuedRequest,
  markRunning,
  recoverStaleRequests,
  selectNextEligibleRequestId,
  tryAdmitRequest,
} from "./ledger.js";
import { createFakeClock, STARVATION_COGNITION_MS } from "./types.js";
import {
  capabilityCanInfluence,
  listCapabilityStatuses,
  promoteCapability,
  promotionEligible,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
} from "../rollout/capabilities.js";
import { DECLARED_CONTRACT_ID } from "./contract-material.js";
import { currentContractId } from "../rollout/capabilities.js";
import { startDeterministicRecallEpoch } from "../rollout/recall-epoch-test-util.js";

const originalKey = env.mistralApiKey;
const originalTpm = env.mistralTokensPerMinute;
const originalGroqKey = env.groqApiKey;
const originalBuild = env.ashleyReleaseId;

afterEach(() => {
  env.mistralApiKey = originalKey;
  env.mistralTokensPerMinute = originalTpm;
  env.groqApiKey = originalGroqKey;
  env.ashleyReleaseId = originalBuild;
  vi.restoreAllMocks();
});

describe("accepted dispatch provenance", () => {
  it("binds contract and build before completion and preserves them across restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-attn-provenance-"));
    const path = join(dir, "nuclear.db");
    env.groqApiKey = "test-key";
    env.ashleyReleaseId = "accepted-build-a";
    let db: DatabaseSync | null = null;
    let reopened: DatabaseSync | null = null;
    try {
      db = openNuclearDb(new DatabaseSync(path));
      const dispatch = await runAttentiveDispatch<{ text: string }>(db, {
        messages: [{ role: "user", content: "accepted provenance fixture" }],
        purpose: "maintenance",
        lane: "curiosity_maintenance",
        modelAlias: env.mistralModel,
        providerId: "groq",
        quotaBucket: "groq:accepted-provenance-test",
        ownerId: "doc",
        cognitiveJobId: 17,
        dispatch: async () => {
          env.ashleyReleaseId = "current-build-b";
          return {
            providerModel: "accepted-model-a",
            usage: { promptTokens: 2, completionTokens: 2 },
            result: { text: "accepted" },
          };
        },
      });
      expect(dispatch.acceptedDispatchIdentity).toMatchObject({
        contractId: currentContractId(),
        buildIdentity: "accepted-build-a",
      });
      const requestId = dispatch.requestId;
      db.close();
      db = null;

      reopened = openNuclearDb(new DatabaseSync(path), {
        continuityOptional: true,
      });
      expect(
        reopened
          .prepare(
            `SELECT accepted_contract_id, accepted_build_identity
             FROM attention_requests WHERE id = ?`,
          )
          .get(requestId),
      ).toEqual({
        accepted_contract_id: currentContractId(),
        accepted_build_identity: "accepted-build-a",
      });
      reopened.close();
      reopened = null;
    } finally {
      try {
        db?.close();
        reopened?.close();
      } catch {
        // Preserve the assertion failure if a connection already closed.
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may retain SQLite locks briefly.
      }
    }
  });
});

function openDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

describe("attentive dispatch timeout truth", () => {
  it("records a deadline AppError timeout as a timeout outcome, not a generic error", async () => {
    env.groqApiKey = "test-key";
    const db = openDb();
    try {
      const error = await runAttentiveDispatch<{ text: string }>(db, {
        messages: [{ role: "user", content: "synthetic timeout fixture" }],
        purpose: "maintenance",
        lane: "curiosity_maintenance",
        modelAlias: "timeout-fixture-model",
        providerId: "groq",
        quotaBucket: "groq:timeout-truth-fixture",
        dispatch: async () => {
          throw new AppError("timeout", "Thought provider deadline exceeded", 408);
        },
      }).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(AppError);
      const row = db.prepare(
        `SELECT state, outcome, error_class FROM attention_requests ORDER BY id DESC LIMIT 1`,
      ).get() as { state: string; outcome: string; error_class: string };
      expect(row).toMatchObject({ state: "terminal", outcome: "timeout", error_class: "timeout" });
    } finally {
      db.close();
    }
  });
});

describe("attention state/outcome invariant", () => {
  it("rejects non-null outcome on non-terminal and null outcome on terminal", () => {
    const db = openDb();
    expect(() =>
      db.prepare(
        `INSERT INTO attention_requests
           (lane, purpose, model_alias, state, outcome, queued_at, eligible_at,
            age_origin_at, estimated_input_tokens, estimated_output_tokens, created_at)
         VALUES ('interactive','expression','m', 'queued', 'completed',
                 datetime('now'), datetime('now'), datetime('now'), 1, 1, datetime('now'))`,
      ).run(),
    ).toThrow();
    expect(() =>
      db.prepare(
        `INSERT INTO attention_requests
           (lane, purpose, model_alias, state, outcome, queued_at, eligible_at,
            age_origin_at, estimated_input_tokens, estimated_output_tokens, created_at)
         VALUES ('interactive','expression','m', 'terminal', NULL,
                 datetime('now'), datetime('now'), datetime('now'), 1, 1, datetime('now'))`,
      ).run(),
    ).toThrow();
    db.close();
  });
});

describe("TPM accounting", () => {
  it("does not count queued estimates toward TPM; cancel consumes none", () => {
    const db = openDb();
    const clock = createFakeClock(1_000_000);
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "mistral-medium-latest",
        estimatedInputTokens: 5_000,
        estimatedOutputTokens: 5_000,
      },
      clock,
    );
    expect(currentTpmUsage(db, clock)).toBe(0);
    completeRequest(db, id, { outcome: "cancelled", errorClass: "test" }, clock);
    expect(currentTpmUsage(db, clock)).toBe(0);
    expect(getRequest(db, id)).toMatchObject({
      state: "terminal",
      outcome: "cancelled",
      reserved_input_tokens: 0,
    });
    db.close();
  });

  it("retains unknown terminal consumption until the 60s window expires", () => {
    const db = openDb();
    const clock = createFakeClock(1_000_000);
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 50,
      },
      clock,
    );
    expect(tryAdmitRequest(db, id, clock).admitted).toBe(true);
    markRunning(db, id, clock);
    completeRequest(
      db,
      id,
      { outcome: "error", errorClass: "unknown", retainUnknownBudget: true },
      clock,
    );
    expect(currentTpmUsage(db, clock)).toBe(150);
    clock.advance(59_000);
    expect(currentTpmUsage(db, clock)).toBe(150);
    clock.advance(2_000);
    expect(currentTpmUsage(db, clock)).toBe(0);
    db.close();
  });

  it("rejects request_exceeds_tpm_budget before queueing when demand alone exceeds TPM", async () => {
    env.mistralApiKey = "test-key";
    env.mistralTokensPerMinute = 1000;
    const db = openDb();
    await expect(
      runAttentiveDispatch(db, {
        messages: [{ role: "user", content: "x".repeat(5000) }],
        purpose: "expression",
        maxTokens: 2000,
        dispatch: async () => {
          throw new Error("should not dispatch");
        },
      }),
    ).rejects.toMatchObject({ code: "request_exceeds_tpm_budget" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM attention_requests`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });
});

describe("atomic admission across connections", () => {
  it("serializes 1 RPS and unique dispatch_sequence", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-attn-"));
    const path = join(dir, "nuclear.db");
    try {
      const a = openNuclearDb(new DatabaseSync(path));
      const b = openNuclearDb(new DatabaseSync(path));
      const clock = createFakeClock(2_000_000);
      const id1 = insertQueuedRequest(
        a,
        {
          lane: "interactive",
          purpose: "expression",
          modelAlias: "m",
          estimatedInputTokens: 10,
          estimatedOutputTokens: 10,
        },
        clock,
      );
      const id2 = insertQueuedRequest(
        b,
        {
          lane: "interactive",
          purpose: "expression",
          modelAlias: "m",
          estimatedInputTokens: 10,
          estimatedOutputTokens: 10,
        },
        clock,
      );
      const first = tryAdmitRequest(a, id1, clock);
      expect(first.admitted).toBe(true);
      markRunning(a, id1, clock);
      const second = tryAdmitRequest(b, id2, clock);
      expect(second.admitted).toBe(false);
      expect(second.reason).toBe("budget_wait");
      const seqs = a
        .prepare(
          `SELECT dispatch_sequence FROM attention_requests
           WHERE dispatch_sequence IS NOT NULL`,
        )
        .all() as Array<{ dispatch_sequence: number }>;
      expect(seqs).toHaveLength(1);
      expect(seqs[0]?.dispatch_sequence).toBe(1);
      a.close();
      b.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows may retain SQLite locks briefly */
      }
    }
  });
});

describe("deadlines and priority", () => {
  it("expires without dispatch when earliest legal time is at deadline", () => {
    const db = openDb();
    const clock = createFakeClock(3_000_000);
    const blocker = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
      },
      clock,
    );
    expect(tryAdmitRequest(db, blocker, clock).admitted).toBe(true);
    markRunning(db, blocker, clock);
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        deadlineAtMs: clock.nowMs() + 500,
      },
      clock,
    );
    const result = tryAdmitRequest(db, id, clock);
    expect(result).toEqual({ admitted: false, reason: "deadline", nextEligibleAtMs: 3_001_000 });
    expect(getRequest(db, id)).toMatchObject({
      state: "terminal",
      outcome: "timeout",
    });
    db.close();
  });

  it("fail-closes deadline-bound thought when groq TPM wait exceeds the 6s thought window", () => {
    const db = openDb();
    const clock = createFakeClock(3_000_000);
    const bucket = "groq:openai/gpt-oss-120b";
    const prior = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "thought",
        modelAlias: "openai/gpt-oss-120b",
        providerId: "groq",
        quotaBucket: bucket,
        estimatedInputTokens: 2_000,
        estimatedOutputTokens: 2_000,
      },
      clock,
    );
    expect(tryAdmitRequest(db, prior, clock).admitted).toBe(true);
    markRunning(db, prior, clock);
    completeRequest(
      db,
      prior,
      { outcome: "completed", actualInput: 2_000, actualOutput: 2_000 },
      clock,
    );
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "thought",
        modelAlias: "openai/gpt-oss-120b",
        providerId: "groq",
        quotaBucket: bucket,
        estimatedInputTokens: 5_000,
        estimatedOutputTokens: 1_000,
        deadlineAtMs: clock.nowMs() + 6_000,
      },
      clock,
    );
    const result = tryAdmitRequest(db, id, clock);
    expect(result).toEqual({ admitted: false, reason: "deadline", nextEligibleAtMs: 3_060_000 });
    expect(getRequest(db, id)).toMatchObject({
      state: "terminal",
      outcome: "timeout",
      error_class: "deadline_before_dispatch",
    });
    db.close();
  });

  it("admits deadline-bound thought when groq TPM frees inside the 6s window", () => {
    const db = openDb();
    const clock = createFakeClock(2_943_000);
    const bucket = "groq:openai/gpt-oss-120b";
    const prior = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "thought",
        modelAlias: "openai/gpt-oss-120b",
        providerId: "groq",
        quotaBucket: bucket,
        estimatedInputTokens: 2_000,
        estimatedOutputTokens: 2_000,
      },
      clock,
    );
    expect(tryAdmitRequest(db, prior, clock).admitted).toBe(true);
    markRunning(db, prior, clock);
    completeRequest(
      db,
      prior,
      { outcome: "completed", actualInput: 2_000, actualOutput: 2_000 },
      clock,
    );
    clock.advance(57_000);
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "thought",
        modelAlias: "openai/gpt-oss-120b",
        providerId: "groq",
        quotaBucket: bucket,
        estimatedInputTokens: 5_000,
        estimatedOutputTokens: 1_000,
        deadlineAtMs: clock.nowMs() + 6_000,
      },
      clock,
    );
    expect(tryAdmitRequest(db, id, clock)).toEqual({
      admitted: false,
      reason: "budget_wait",
      nextEligibleAtMs: 3_003_000,
    });
    clock.advance(3_000);
    expect(tryAdmitRequest(db, id, clock).admitted).toBe(true);
    expect(getRequest(db, id)).toMatchObject({ state: "reserved" });
    db.close();
  });

  it("runAttentiveDispatch exposes advisory nextEligibleAtMs when deadline is exceeded", async () => {
    env.mistralApiKey = "test-key";
    env.mistralTokensPerMinute = 1_000;
    const db = openDb();
    const clock = createFakeClock(5_000_000);
    const prior = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "thought",
        modelAlias: "mistral-small-2603",
        providerId: "mistral",
        quotaBucket: "mistral:mistral-small-2603",
        estimatedInputTokens: 400,
        estimatedOutputTokens: 400,
      },
      clock,
    );
    expect(tryAdmitRequest(db, prior, clock).admitted).toBe(true);
    markRunning(db, prior, clock);
    completeRequest(
      db,
      prior,
      { outcome: "completed", actualInput: 400, actualOutput: 400 },
      clock,
    );

    let caught: unknown = null;
    try {
      await runAttentiveDispatch(
        db,
        {
          messages: [{ role: "user", content: "hello" }],
          purpose: "thought",
          providerId: "mistral",
          quotaBucket: "mistral:mistral-small-2603",
          maxTokens: 300,
          deadlineAtMs: clock.nowMs() + 5_000,
          dispatch: async () => {
            throw new Error("should not dispatch");
          },
        },
        clock,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({
      code: "attention_deadline",
      nextEligibleAtMs: expect.any(Number),
    });
    expect((caught as { nextEligibleAtMs: number }).nextEligibleAtMs).toBeGreaterThan(clock.nowMs() + 5_000);
    db.close();
  });

  it("never admits overdue background ahead of interactive", () => {
    const db = openDb();
    const clock = createFakeClock(4_000_000);
    const background = insertQueuedRequest(
      db,
      {
        lane: "exchange_cognition",
        purpose: "exchange_cognition",
        modelAlias: "m",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        ageOriginAtMs: clock.nowMs() - STARVATION_COGNITION_MS - 1,
      },
      clock,
    );
    const interactive = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
      },
      clock,
    );
    expect(selectNextEligibleRequestId(db, clock)).toBe(interactive);
    expect(tryAdmitRequest(db, background, clock).admitted).toBe(false);
    expect(tryAdmitRequest(db, interactive, clock).admitted).toBe(true);
    db.close();
  });

  it("preserves durable age_origin_at across restart recovery", () => {
    const db = openDb();
    const clock = createFakeClock(5_000_000);
    const origin = clock.nowMs() - 10_000;
    const id = insertQueuedRequest(
      db,
      {
        lane: "exchange_cognition",
        purpose: "exchange_cognition",
        modelAlias: "m",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        ageOriginAtMs: origin,
      },
      clock,
    );
    const before = getRequest(db, id);
    expect(before?.age_origin_at).toBe(new Date(origin).toISOString());
    recoverStaleRequests(db, clock);
    const after = getRequest(db, id);
    expect(after).toMatchObject({
      state: "terminal",
      outcome: "aborted",
      error_class: "process_restart_before_dispatch",
      age_origin_at: new Date(origin).toISOString(),
    });
    db.close();
  });
});

describe("model continuity", () => {
  it("distinguishes alias echo and omitted model as unresolved", () => {
    expect(resolveProviderModelId("mistral-medium-latest", "mistral-medium-latest"))
      .toEqual({ resolvedModelId: null, unresolvedAlias: true });
    expect(resolveProviderModelId("mistral-medium-latest", null)).toEqual({
      resolvedModelId: null,
      unresolvedAlias: true,
    });
    expect(
      resolveProviderModelId("mistral-medium-latest", "mistral-medium-2505"),
    ).toEqual({
      resolvedModelId: "mistral-medium-2505",
      unresolvedAlias: false,
    });
  });

  it("baselines, changes epoch, ignores stale sequences, preserves disabled", () => {
    const db = openDb();
    const clock = createFakeClock(6_000_000);
    const demotions: string[] = [];
    const demote = () => {
      demotions.push("demote");
      db.prepare(
        `UPDATE capability_releases SET state = 'observe'
         WHERE capability = 'thought' AND release_id = ? AND state = 'active'`,
      ).run(DECLARED_CONTRACT_ID);
    };
    expect(
      applyModelContinuity(
        db,
        {
          alias: "mistral-medium-latest",
          resolvedModelId: "model-a",
          unresolvedAlias: false,
          dispatchSequence: 1,
        },
        demote,
        clock,
      ),
    ).toMatchObject({ kind: "baseline", epoch: 1 });
    expect(demotions).toHaveLength(0);

    db.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
       VALUES ('thought', ?, 'active', ?, ?, 'build', 1),
              ('recall', ?, 'disabled', ?, ?, 'build', 0)`,
    ).run(
      DECLARED_CONTRACT_ID,
      new Date(clock.nowMs()).toISOString(),
      DECLARED_CONTRACT_ID,
      DECLARED_CONTRACT_ID,
      new Date(clock.nowMs()).toISOString(),
      DECLARED_CONTRACT_ID,
    );

    expect(
      applyModelContinuity(
        db,
        {
          alias: "mistral-medium-latest",
          resolvedModelId: "model-b",
          unresolvedAlias: false,
          dispatchSequence: 3,
        },
        demote,
        clock,
      ),
    ).toMatchObject({ kind: "resolved_change", epoch: 2 });
    expect(demotions).toHaveLength(1);
    expect(
      db
        .prepare(
          `SELECT state FROM capability_releases
           WHERE capability = 'thought' AND release_id = ?`,
        )
        .get(DECLARED_CONTRACT_ID),
    ).toMatchObject({ state: "observe" });
    expect(
      db
        .prepare(
          `SELECT state FROM capability_releases
           WHERE capability = 'recall' AND release_id = ?`,
        )
        .get(DECLARED_CONTRACT_ID),
    ).toMatchObject({ state: "disabled" });

    expect(
      applyModelContinuity(
        db,
        {
          alias: "mistral-medium-latest",
          resolvedModelId: "model-c",
          unresolvedAlias: false,
          dispatchSequence: 2,
        },
        demote,
        clock,
      ),
    ).toMatchObject({ kind: "stale", epoch: 2 });
    expect(demotions).toHaveLength(1);
    db.close();
  });

  it("blocks immediate re-promotion from prior-epoch evidence", () => {
    const db = openDb();
    const clock = createFakeClock(7_000_000);
    applyModelContinuity(
      db,
      {
        alias: env.mistralModel,
        resolvedModelId: "model-a",
        unresolvedAlias: false,
        dispatchSequence: 1,
      },
      () => undefined,
      clock,
    );
    startDeterministicRecallEpoch(db);
    recordIsolatedEvaluation(db, "recall", {
      seeds: 3,
      passed: true,
      sourceKey: "r-eval",
      occurredAt: new Date(clock.nowMs()).toISOString(),
    });
    for (let i = 0; i < 25; i++) {
      recordLiveShadowEvent(db, "recall", `r-${i}`, {
        occurredAt: new Date(clock.nowMs() + i * (7 * 86_400_000) / 24).toISOString(),
      });
    }
    recordIsolatedEvaluation(db, "mind_state", {
      seeds: 3,
      passed: true,
      sourceKey: "m-eval",
      occurredAt: new Date(clock.nowMs()).toISOString(),
    });
    for (let i = 0; i < 25; i++) {
      recordLiveShadowEvent(db, "mind_state", `m-${i}`, {
        occurredAt: new Date(clock.nowMs() + i * (7 * 86_400_000) / 24).toISOString(),
      });
    }
    recordIsolatedEvaluation(db, "thought", {
      seeds: 3,
      passed: true,
      sourceKey: "t-eval",
      occurredAt: new Date(clock.nowMs()).toISOString(),
    });
    for (let i = 0; i < 25; i++) {
      recordLiveShadowEvent(db, "thought", `t-${i}`, {
        occurredAt: new Date(clock.nowMs() + i * (7 * 86_400_000) / 24).toISOString(),
      });
    }
    for (const capability of ["recall", "mind_state", "thought"] as const) {
      expect(promoteCapability(db, capability, { authorizedBy: "owner-1" }))
        .toEqual({ ok: true, state: "active" });
    }
    expect(capabilityCanInfluence(db, "thought", "apply")).toBe(true);

    applyModelContinuity(
      db,
      {
        alias: env.mistralModel,
        resolvedModelId: "model-b",
        unresolvedAlias: false,
        dispatchSequence: 2,
      },
      (d) => {
        d.prepare(
          `UPDATE capability_releases SET state = 'observe'
           WHERE capability = 'thought' AND release_id = ? AND state = 'active'`,
        ).run(DECLARED_CONTRACT_ID);
      },
      clock,
    );
    expect(capabilityCanInfluence(db, "thought", "apply")).toBe(false);
    expect(
      listCapabilityStatuses(db, "apply").find((s) => s.capability === "thought"),
    ).toMatchObject({ state: "observe", liveShadowEvents: 0 });
    expect(promotionEligible(db, "thought")).toBe(false);
    expect(promoteCapability(db, "thought", { authorizedBy: "owner-1" }))
      .toEqual({ ok: false, reason: "not_eligible" });
    db.close();
  });
});

describe("contract fail-closed and daily fold", () => {
  it("fails influence closed on contract mismatch", () => {
    const db = openDb();
    ensureBootstrapContract(db);
    db.prepare(
      `UPDATE capability_contracts SET spec_hash = 'wrong' WHERE active = 1`,
    ).run();
    expect(contractMismatch(db)).toBe(true);
    expect(capabilityCanInfluence(db, "recall", "apply")).toBe(false);
    expect(declaredContractHash().length).toBe(64);
    db.close();
  });

  it("folds the same day twice identically and monthly totals once", () => {
    const db = openDb();
    const clock = createFakeClock(Date.parse("2026-08-01T12:00:00.000Z"));
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        estimatedInputTokens: 10,
        estimatedOutputTokens: 5,
      },
      clock,
    );
    expect(tryAdmitRequest(db, id, clock).admitted).toBe(true);
    markRunning(db, id, clock);
    completeRequest(
      db,
      id,
      {
        outcome: "completed",
        actualInput: 8,
        actualOutput: 4,
        resolvedModelId: "model-a",
      },
      clock,
    );
    expect(foldAttentionDailyUsage(db, clock)).toBe(1);
    const first = db
      .prepare(`SELECT * FROM attention_daily_usage`)
      .get() as Record<string, unknown>;
    expect(foldAttentionDailyUsage(db, clock)).toBe(0);
    const second = db
      .prepare(`SELECT * FROM attention_daily_usage`)
      .get() as Record<string, unknown>;
    expect(second).toEqual(first);
    const monthly = monthlyUsageSummary(db, 30, clock);
    expect(monthly.actualInputTokens).toBe(8);
    expect(monthly.actualOutputTokens).toBe(4);
    expect(monthly.requests).toBe(1);
    db.close();
  });
});

describe("governor dispatch", () => {
  it("creates no reservation when API key is missing", async () => {
    env.mistralApiKey = "";
    const db = openDb();
    await expect(
      runAttentiveDispatch(db, {
        messages: [{ role: "user", content: "hi" }],
        purpose: "expression",
        dispatch: async () => ({ result: "x" }),
      }),
    ).rejects.toMatchObject({ code: "agent_not_ready" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM attention_requests`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("returns alias vs resolvedModelId and times out late results", async () => {
    env.mistralApiKey = "test-key";
    const db = openDb();
    const clock = createFakeClock(8_000_000);
    const result = await runAttentiveDispatch<{ text: string }>(
      db,
      {
        messages: [{ role: "user", content: "hi" }],
        purpose: "maintenance",
        maxTokens: 16,
        deadlineAtMs: clock.nowMs() + 60_000,
        dispatch: async () => ({
          providerModel: "mistral-medium-2505",
          usage: { promptTokens: 3, completionTokens: 2 },
          result: { text: "ok" },
        }),
      },
      clock,
    );
    expect(result.modelAlias).toBe(env.mistralModel);
    expect(result.resolvedModelId).toBe("mistral-medium-2505");

    const lateClock = createFakeClock(9_000_000);
    await expect(
      runAttentiveDispatch(
        db,
        {
          messages: [{ role: "user", content: "late" }],
          purpose: "expression",
          maxTokens: 16,
          deadlineAtMs: lateClock.nowMs() + 100,
          dispatch: async () => {
            lateClock.advance(200);
            return {
              providerModel: "mistral-medium-2505",
              usage: { promptTokens: 1, completionTokens: 1 },
              result: { text: "late" },
            };
          },
        },
        lateClock,
      ),
    ).rejects.toMatchObject({ code: "attention_deadline" });
    db.close();
  });
});

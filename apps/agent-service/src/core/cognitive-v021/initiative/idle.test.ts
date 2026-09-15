import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR } from "../types.js";
import { openTestSidecar } from "../test-support.js";
import { PRIVATE_THOUGHT_POLICY_ID } from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import { tickIdleOpportunity } from "./idle.js";
import { scheduleFutureTrigger } from "./future-triggers.js";
import { resolveObservationBinding } from "../observation/persistence.js";
import { createObservationSubscription, MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS } from "../observation/subscriptions.js";
import {
  listDueCommitmentOpportunities,
  persistCommitmentProposals,
  settlePersistedCommitmentProposals,
  type CommitmentProposal,
} from "../../relationship/commitment-admission.js";

function seedActiveOccupancy(db: ReturnType<typeof openTestSidecar>, conversationId = "thread-idle"): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, status, snapshot_hash, updated_cycle)
     VALUES ('concern-idle', ?, 'revisit HY3', '[]', '{}', NULL, 'active', 'snapshot-idle', NULL)`,
  ).run(conversationId);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES (?, 'concern-idle', 'active', 20, 'cycle-seed', 1)`,
  ).run(conversationId);
}

function establishEpoch(db: ReturnType<typeof openTestSidecar>, nowMs: number): void {
  reconcilePolicyClock(db, { policyId: PRIVATE_THOUGHT_POLICY_ID, wallClockNowMs: nowMs, authorizationRef: "owner:test-epoch" });
}

function commitmentProposal(): CommitmentProposal {
  return {
    ordinal: 0,
    action: "send the Owner a progress update",
    beneficiary: "owner",
    destination: { kind: "owner_private" },
    temporal: { kind: "open" },
    realizationClause: "I will send the Owner a progress update when the evidence supports it.",
    thoughtCycle: { cycleId: "cycle-idle-commitment", attemptId: "attempt-idle-commitment" },
  };
}

describe("v0.2.1 idle executive", () => {
  it("does not call Thought in an empty house, even after ten ticks", async () => {
    const db = openTestSidecar();
    try {
      let calls = 0;
      for (let index = 0; index < 10; index += 1) {
        const result = await tickIdleOpportunity(db, {
          conversationId: "thread-empty",
          nowMs: index,
          runThought: async () => {
            calls += 1;
            return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
          },
        });
        expect(result.thoughtModelAttempts).toBe(0);
        expect(result.idleEligible).toBe(false);
        expect(result.semanticAbsenceClaim).toBe("yes");
      }
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("revisits active occupancy once and accepts private silence", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db);
      establishEpoch(db, 100);
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-idle",
        nowMs: 100,
        runThought: async (input) => {
          calls += 1;
          expect(input.trigger.kind).toBe("idle_opportunity");
          expect(input.occupancy).toEqual([expect.objectContaining({ concernId: "concern-idle", status: "active" })]);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(calls).toBe(1);
      expect(result.thoughtModelAttempts).toBe(1);
      expect(result.acceptedSettlements).toBe(1);
      expect(result.idleEligible).toBe(true);
      expect(result.semanticAbsenceClaim).toBe("no");
    } finally {
      db.close();
    }
    const source = readFileSync(fileURLToPath(new URL("./idle.ts", import.meta.url)), "utf8").toLowerCase();
    expect(source).not.toContain("score");
    expect(source).not.toContain("interesting");
    expect(source).not.toContain("decide(");
  });

  it("does not write dormancy after unchanged private no-op idles", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-dormant");
      establishEpoch(db, 1000);
      let calls = 0;
      for (let index = 0; index < 4; index += 1) {
        const result = await tickIdleOpportunity(db, {
          conversationId: "thread-dormant",
          nowMs: 1000 + index,
          runThought: async () => {
            calls += 1;
            return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
          },
        });
        expect(result.dormant).toBe(false);
      }
      expect(calls).toBe(4);
      expect(db.prepare("SELECT status FROM mind_occupancy WHERE conversation_id = 'thread-dormant'").get()).toMatchObject({ status: "active" });
      expect(db.prepare("SELECT status FROM concerns WHERE conversation_id = 'thread-dormant'").get()).toMatchObject({ status: "active" });
    } finally {
      db.close();
    }
  });

  it("does not wake for LearnedSelf interest or an unmatched curiosity item", async () => {
    const db = openTestSidecar();
    try {
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-interest",
        nowMs: 1,
        learnedSelfSlice: { dispositions: [], interests: ["space"] },
        curiosityItems: [{ text: "space news" }],
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(result.thoughtModelAttempts).toBe(0);
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("projects a due undertaking into Thought with unknown evidence when observation is incomplete", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const nowMs = 1_000;
      establishEpoch(sidecar, nowMs);
      persistCommitmentProposals(nuclear, "idle-due", [commitmentProposal()]);
      settlePersistedCommitmentProposals(nuclear, "idle-due", { ownerId: "owner-1", nowMs, enabled: true });
      const commitment = listDueCommitmentOpportunities(nuclear, "owner-1", nowMs)[0];
      expect(commitment).toBeDefined();

      let observed: import("./idle.js").IdleThoughtContext | null = null;
      const result = await tickIdleOpportunity(sidecar, {
        conversationId: "thread-commitment-due",
        occupantId: "owner-1",
        nowMs,
        commitmentDb: nuclear,
        commitmentOwnerId: "owner-1",
        commitment,
        runThought: async (input) => {
          observed = input;
          return { published: false, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(observed!.trigger).toEqual({ kind: "commitment_due", ref: "cmt:idle-due:0" });
      expect(observed).toMatchObject({
        commitmentId: "cmt:idle-due:0",
        realizationClause: commitment?.realizationClause,
        evidenceCompleteness: "unknown",
      });
      expect(result).toMatchObject({ eligible: true, thoughtCalls: 1, semanticAbsenceClaim: "no" });
      expect(nuclear.prepare("SELECT commitment_state FROM ashley_self_commitments WHERE entity_uuid = ?").get("cmt:idle-due:0"))
        .toMatchObject({ commitment_state: "attempted" });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("stops private Thought calls at the hourly executive budget", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-budget");
      establishEpoch(db, 10_000);
      let calls = 0;
      let exhaustedResult;
      for (let index = 0; index < PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR + 1; index += 1) {
        const result = await tickIdleOpportunity(db, {
          conversationId: "thread-budget",
          nowMs: 10_000 + index * 100,
          runThought: async () => {
            calls += 1;
            return { published: true, outboxId: 1, thoughtModelAttempts: 1, speechMode: "draft" as const };
          },
        });
        if (index === PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR) exhaustedResult = result;
      }
      expect(calls).toBe(PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR);
      expect(exhaustedResult?.reason).toBe("private_compute_budget");
      expect(db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE conversation_id = 'thread-budget'").get()).toMatchObject({ count: PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR });
    } finally {
      db.close();
    }
  });

  it("admits a bounded curiosity observation through the existing idle opportunity", async () => {
    const db = openTestSidecar();
    try {
      establishEpoch(db, 100);
      let acquisitionCalls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-curiosity",
        nowMs: 100,
        curiosityObservationProvider: async (input: { conversationId: string; nowMs: number }) => {
          acquisitionCalls += 1;
          expect(input).toMatchObject({ conversationId: "thread-curiosity", nowMs: 100 });
          return [{
            observationId: "curiosity:read:7:abc",
            derived: true,
            replaySafe: true,
            modality: "page" as const,
            payload: {
              readId: 7,
              itemId: 9,
              finalUrl: "https://example.com/article",
              contentHash: "abc",
              retrievedAt: "2026-09-09T00:00:00.000Z",
              title: "A bounded page",
              excerpts: ["Untrusted source evidence."],
              inputTrust: "untrusted_evidence",
            },
            provenance: "curiosity:read:7:abc",
            dataClassification: "ordinary" as const,
            secretOmitted: false,
          }];
        },
        runThought: async (input: import("./idle.js").IdleThoughtContext) => {
          expect(input.trigger.kind).toBe("idle_opportunity");
          expect(input.observations).toEqual([
            expect.objectContaining({
              observationId: "curiosity:read:7:abc",
              cycleId: input.cycle.cycleId,
              generation: input.cycle.generation,
            }),
          ]);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      } as any);

      expect(acquisitionCalls).toBe(1);
      expect(result).toMatchObject({ eligible: true, thoughtModelAttempts: 1, acceptedSettlements: 1 });
      expect(result.semanticAbsenceClaim).toBe("no");
      expect(db.prepare("SELECT COUNT(*) AS count FROM concerns").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("routes an admitted external watch through idle matching without a Thought call on a not-due poll", async () => {
    const db = openTestSidecar();
    try {
      const nowMs = 10_000;
      establishEpoch(db, nowMs);
      createObservationSubscription(db, {
        subscriptionId: "idle-external-watch",
        conversationId: "thread-external-watch",
        concernId: null,
        source: "external_watch",
        scope: "owner-thread",
        topicKeys: ["HY3"],
        match: "substring",
        expiresAtMs: nowMs + 100_000,
        externalSource: { kind: "url", urlPattern: "https://public.test/watch" },
        pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
        requesterId: "owner-42",
      });
      const fetcher = async () => new Response("<html><body>HY3 changed</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
      let thoughtCalls = 0;
      const first = await tickIdleOpportunity(db, {
        conversationId: "thread-external-watch",
        occupantId: "owner-42",
        nowMs,
        externalWatch: { fetcher, resolve },
        runThought: async (input) => {
          thoughtCalls += 1;
          expect(input.trigger.kind).toBe("subscription_item");
          expect(input.observations[0]?.payload).toMatchObject({ requesterId: "owner-42", ownerRequested: true });
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(first).toMatchObject({ eligible: true, thoughtCalls: 1, acceptedSettlements: 1 });

      const second = await tickIdleOpportunity(db, {
        conversationId: "thread-external-watch",
        occupantId: "owner-42",
        nowMs: nowMs + 1,
        externalWatch: { fetcher, resolve },
        runThought: async () => {
          thoughtCalls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(second.reason).toBe("empty_house");
      expect(thoughtCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("does not turn a stale suppressed trigger into a curiosity opportunity", async () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES ('resolved-concern', 'thread-stale', 'old concern', '[]', '{}', NULL,
                 'resolved', 'resolved-snapshot', NULL)`,
      ).run();
      scheduleFutureTrigger(db, {
        triggerId: "stale-curiosity-trigger",
        conversationId: "thread-stale",
        concernId: "resolved-concern",
        snapshotHash: "resolved-snapshot",
        dueAtMs: 1,
      });
      let acquisitions = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-stale",
        nowMs: 2,
        curiosityObservationProvider: async () => {
          acquisitions += 1;
          return [];
        },
        runThought: async () => ({ published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const }),
      });

      expect(acquisitions).toBe(0);
      expect(result.reason).toBe("empty_house");
      expect(result.thoughtCalls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("leaves acquired evidence mechanical when private Thought admission is exhausted", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-mechanical-only");
      establishEpoch(db, 10_000);
      let acquisitions = 0;
      let thoughtCalls = 0;
      const draft = {
        observationId: "curiosity:read:mechanical:hash",
        derived: true,
        replaySafe: true,
        modality: "page" as const,
        payload: { inputTrust: "untrusted_evidence" },
        provenance: "curiosity:read:mechanical:hash",
        dataClassification: "ordinary" as const,
        secretOmitted: false,
      };
      for (let index = 0; index < PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR; index += 1) {
        await tickIdleOpportunity(db, {
          conversationId: "thread-mechanical-only",
          nowMs: 10_000 + index * 100,
          curiosityObservationProvider: async () => {
            acquisitions += 1;
            return [draft];
          },
          runThought: async () => {
            thoughtCalls += 1;
            return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
          },
        });
      }
      const exhausted = await tickIdleOpportunity(db, {
        conversationId: "thread-mechanical-only",
        nowMs: 11_300,
        curiosityObservationProvider: async () => {
          acquisitions += 1;
          return [draft];
        },
        runThought: async () => {
          thoughtCalls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(acquisitions).toBe(PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR + 1);
      expect(thoughtCalls).toBe(PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR);
      expect(exhausted).toMatchObject({ reason: "private_compute_budget", observations: [] });
      expect(db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE conversation_id = 'thread-mechanical-only'").get())
        .toMatchObject({ count: PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR });
      expect(db.prepare("SELECT COUNT(*) AS count FROM concerns WHERE conversation_id = 'thread-mechanical-only'").get())
        .toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });
  it("preserves unknown physical execution provenance without changing legacy counters", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "idle-provenance");
      establishEpoch(db, 10);
      const result = await tickIdleOpportunity(db, {
        conversationId: "idle-provenance",
        nowMs: 10,
        runThought: async () => ({
          published: false,
          thoughtModelAttempts: 0,
          thoughtExecutionProvenance: {
            dispatchTruth: "unknown" as const,
            providerAttempts: "unknown" as const,
          },
        }),
      });

      expect(result).toMatchObject({
        thoughtModelAttempts: 0,
        thoughtCalls: 1,
        thoughtExecutionProvenance: { dispatchTruth: "unknown", providerAttempts: "unknown" },
      });
    } finally {
      db.close();
    }
  });
});

describe("P1 periodic scheduling through the idle tick (R7 §§5–14)", () => {
  const DUE = 100_000_000;

  function enableSchedule(db: ReturnType<typeof openTestSidecar>, nowMs: number): void {
    db.prepare(
      `INSERT INTO periodic_cognition_schedule
         (id, authority_epoch, next_eligible_at_ms, updated_at_ms)
       VALUES ('ashley-periodic-v1', 1, ?, ?)`,
    ).run(nowMs, nowMs);
  }

  it("FIRST_OWNER_AUTHORIZED_ACTIVATION_CREATES_SCHEDULE_ONLY", async () => {
    const db = openTestSidecar();
    try {
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-first",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      const schedule = db.prepare("SELECT * FROM periodic_cognition_schedule WHERE id = 'ashley-periodic-v1'").get() as Record<string, unknown>;
      expect(schedule.next_eligible_at_ms).toBe(DUE + 14_400_000);
      expect(schedule.pending_occurrence_id).toBeNull();
      expect(calls).toBe(0);
      expect(result.thoughtCalls).toBe(0);
      expect(result.reason).toBe("periodic_not_due");
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("DISABLED_STAGING_DOES_NOT_ADMIT_PERIODIC_THOUGHT", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-disabled");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      const triggerRefs: string[] = [];
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-disabled",
        nowMs: DUE,
        periodicCognitionEnabled: false,
        runThought: async (input) => {
          triggerRefs.push(input.trigger.ref);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      // No periodic Thought, no periodic wake, no periodic reservation, no
      // pending occurrence — while ordinary idle Thought still serves.
      expect(result.thoughtCalls).toBe(1);
      expect(triggerRefs).toHaveLength(1);
      expect(triggerRefs.every((ref) => !ref.startsWith("periodic:"))).toBe(true);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
      expect(db.prepare("SELECT pending_occurrence_id FROM periodic_cognition_schedule WHERE id = 'ashley-periodic-v1'").get()).toMatchObject({
        pending_occurrence_id: null,
      });
    } finally {
      db.close();
    }
  });

  it("KILL_SWITCH_MISSING_ENV_FAILS_CLOSED at the tick level", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-noenv");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      const triggerRefs: string[] = [];
      await tickIdleOpportunity(db, {
        conversationId: "thread-noenv",
        nowMs: DUE,
        runThought: async (input) => {
          triggerRefs.push(input.trigger.ref);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      // No explicit option and no env: treated as disabled — ordinary Thought
      // serves, periodic admits nothing.
      expect(triggerRefs).toHaveLength(1);
      expect(triggerRefs.every((ref) => !ref.startsWith("periodic:"))).toBe(true);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("DISABLED_STAGING_PRESERVES_EXISTING_DUE_TRIGGER_SERVICE", async () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES ('concern-due', 'thread-due', 'due concern', '[]', '{}', NULL, 'active', 'snapshot-due', NULL)`,
      ).run();
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES ('thread-due', 'concern-due', 'active', 20, 'cycle-due', 1)`,
      ).run();
      scheduleFutureTrigger(db, {
        triggerId: "due-trigger-service",
        conversationId: "thread-due",
        concernId: "concern-due",
        snapshotHash: "snapshot-due",
        dueAtMs: DUE - 10,
      });
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-due",
        nowMs: DUE,
        periodicCognitionEnabled: false,
        runThought: async () => ({ published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const }),
      });
      expect(result.firedTriggers.map((trigger) => trigger.triggerId)).toContain("due-trigger-service");
    } finally {
      db.close();
    }
  });

  it("T8 precedence: both-due services the trigger first, periodic stays pending", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-bothdue");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES ('concern-bothdue', 'thread-bothdue', 'due concern', '[]', '{}', NULL, 'active', 'snapshot-bothdue', NULL)`,
      ).run();
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES ('thread-bothdue', 'concern-bothdue', 'active', 20, 'cycle-bothdue', 1)`,
      ).run();
      scheduleFutureTrigger(db, {
        triggerId: "bothdue-trigger",
        conversationId: "thread-bothdue",
        concernId: "concern-bothdue",
        snapshotHash: "snapshot-bothdue",
        dueAtMs: DUE - 10,
      });
      const triggerRefs: string[] = [];
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-bothdue",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        runThought: async (input) => {
          triggerRefs.push(input.trigger.ref);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(result.firedTriggers.map((trigger) => trigger.triggerId)).toContain("bothdue-trigger");
      expect(triggerRefs.every((ref) => !ref.startsWith("periodic:"))).toBe(true);
      // The periodic occurrence is minted but stays PENDING in its window:
      // the trigger is serviced first, no periodic Thought runs.
      const schedule = db.prepare("SELECT pending_occurrence_id, pending_wake_id FROM periodic_cognition_schedule WHERE id = 'ashley-periodic-v1'").get() as Record<string, unknown>;
      expect(typeof schedule.pending_occurrence_id).toBe("string");
      expect(schedule.pending_wake_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("enabled full path admits on the frozen binding and runs Thought once", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-full");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      const seen: Array<{ ref: string; conversationId: string }> = [];
      const acquired = {
        observationId: "periodic:observation:one",
        derived: true,
        replaySafe: true,
        modality: "page" as const,
        payload: { content: "bounded evidence" },
        provenance: "test:periodic",
        dataClassification: "ordinary" as const,
        secretOmitted: false,
      };
      let observedInput: import("./idle.js").IdleThoughtContext | null = null;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-full",
        occupantId: "owner",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => [acquired],
        runThought: async (input) => {
          observedInput = input;
          seen.push({ ref: input.trigger.ref, conversationId: input.cycle.conversationId });
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      const payload = observedInput!.event?.payload as Record<string, unknown>;
      expect(payload.ownerId).toBe("owner");
      expect(payload.channel).toBe("discord");
      expect(payload.observationsCapture).toBe("present");
      expect(payload.observationIds).toEqual([acquired.observationId]);
      expect(payload.observationCount).toBe(1);
      const resolved = resolveObservationBinding(db, payload, observedInput!.cycle);
      expect(resolved.kind).toBe("known");
      expect(resolved.kind === "known" ? resolved.observations : []).toEqual(observedInput!.observations);
      expect(result.thoughtCalls).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.ref.startsWith("periodic:")).toBe(true);
      expect(seen[0]!.conversationId).toBe("thread-full");
      // Frozen binding: one wake, one reservation, one deterministic event.
      // (The mock runner never dispatches, so the existing post-Thought
      // settle marks the reservation unknown — admission-time held truth is
      // pinned at the evaluation level; here the binding identity matters.)
      const schedule = db.prepare("SELECT pending_occurrence_id, pending_wake_id FROM periodic_cognition_schedule WHERE id = 'ashley-periodic-v1'").get() as Record<string, unknown>;
      expect(typeof schedule.pending_occurrence_id).toBe("string");
      expect(typeof schedule.pending_wake_id).toBe("string");
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(1);
      const eventRow = db.prepare("SELECT payload_json FROM inbox_events WHERE id = ?").get(`periodic:${String(schedule.pending_occurrence_id)}`) as { payload_json: string };
      const eventReservationId = (JSON.parse(eventRow.payload_json) as Record<string, unknown>).privateBudgetReservationId;
      expect(typeof eventReservationId).toBe("string");
      expect(db.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(String(eventReservationId))).toMatchObject({
        wake_id: schedule.pending_wake_id,
      });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = ?").get(`periodic:${String(schedule.pending_occurrence_id)}`) as { count: number },
      ).toMatchObject({ count: 1 });

      // Second tick: the live event owns the occurrence — no second
      // periodic Thought (ordinary idle Thought may still serve).
      const secondRefs: string[] = [];
      await tickIdleOpportunity(db, {
        conversationId: "thread-full",
        nowMs: DUE + 1_000,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => [],
        runThought: async (input) => {
          secondRefs.push(input.trigger.ref);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(secondRefs.every((ref) => !ref.startsWith("periodic:"))).toBe(true);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("fails closed before periodic event append on an observation-ID semantic collision", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-collision");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      db.prepare(
        `INSERT INTO observations
           (observation_id, cycle_id, generation, derived, replay_safe, modality,
            payload_json, provenance, raw_outranks_derived_of, data_classification,
            secret_omitted, created_at_ms)
         VALUES ('periodic:collision', 'old-cycle', 1, 1, 1, 'page',
                 '{"content":"old"}', 'old-source', NULL, 'ordinary', 0, 1)`,
      ).run();
      let thoughtCalls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-collision",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => [{
          observationId: "periodic:collision",
          derived: true,
          replaySafe: true,
          modality: "page" as const,
          payload: { content: "new" },
          provenance: "new-source",
          dataClassification: "ordinary" as const,
          secretOmitted: false,
        }],
        runThought: async () => {
          thoughtCalls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(result.reason).toBe("periodic_observation_binding_conflict");
      expect(thoughtCalls).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get())
        .toMatchObject({ count: 0 });
      expect(db.prepare("SELECT payload_json, cycle_id, generation FROM observations WHERE observation_id = 'periodic:collision'").get())
        .toMatchObject({ payload_json: '{"content":"old"}', cycle_id: "old-cycle", generation: 1 });
    } finally {
      db.close();
    }
  });

  it("bound delegation ignores thread change (frozen-after-admission)", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-home");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE - 1);
      // First tick admits and freezes but runs no Thought (no runner): the
      // occurrence stays bound pre-reservation... actually reservation-first:
      // evaluation reserves, delegation finds no runner and retains.
      await tickIdleOpportunity(db, {
        conversationId: "thread-home",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => [],
      });
      const schedule = db.prepare("SELECT pending_occurrence_id, pending_wake_id FROM periodic_cognition_schedule WHERE id = 'ashley-periodic-v1'").get() as Record<string, unknown>;
      expect(typeof schedule.pending_occurrence_id).toBe("string");
      expect(typeof schedule.pending_wake_id).toBe("string");
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
      // Owner switched threads: the bound occurrence still runs on its
      // frozen conversation, ignoring the scope change.
      const seen: string[] = [];
      const recovered = await tickIdleOpportunity(db, {
        conversationId: "thread-elsewhere",
        nowMs: DUE + 1_000,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => [],
        runThought: async (input) => {
          seen.push(input.cycle.conversationId);
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });
      expect(seen).toEqual([]);
      expect(recovered.reason).toBe("periodic_observation_binding_conflict");
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("zero curiosity network on non-due polls", async () => {
    const db = openTestSidecar();
    try {
      seedActiveOccupancy(db, "thread-nodue");
      establishEpoch(db, DUE);
      enableSchedule(db, DUE + 1_000_000);
      let acquisitions = 0;
      await tickIdleOpportunity(db, {
        conversationId: "thread-nodue",
        nowMs: DUE,
        periodicCognitionEnabled: true,
        curiosityObservationProvider: async () => {
          acquisitions += 1;
          return [];
        },
        runThought: async () => ({ published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const }),
      });
      // Only the ordinary idle path may acquire (once); periodic adds none.
      expect(acquisitions).toBe(1);
    } finally {
      db.close();
    }
  });
});

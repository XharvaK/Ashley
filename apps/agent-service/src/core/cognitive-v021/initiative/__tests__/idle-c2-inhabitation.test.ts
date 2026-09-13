import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { PRIVATE_THOUGHT_POLICY_ID } from "../../private-budget/ledger.js";
import { reconcilePolicyClock } from "../../private-budget/policy-time-ledger.js";
import { tickIdleOpportunity } from "../idle.js";

function seedActiveOccupancy(db: ReturnType<typeof openTestSidecar>, conversationId: string): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, status, snapshot_hash, updated_cycle)
     VALUES (?, ?, 'revisit grounded concern', '[]', '{}', NULL, 'active', 'snapshot-idle-c2', NULL)`,
  ).run(`concern-${conversationId}`, conversationId);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES (?, ?, 'active', 20, 'cycle-idle-c2', 1)`,
  ).run(conversationId, `concern-${conversationId}`);
}

function establishEpoch(db: ReturnType<typeof openTestSidecar>, nowMs: number): void {
  reconcilePolicyClock(db, {
    policyId: PRIVATE_THOUGHT_POLICY_ID,
    wallClockNowMs: nowMs,
    authorizationRef: "owner:test-w9-idle",
  });
}

describe("W9 native idle-life C2 inhabitation", () => {
  it("keeps a successfully empty house silent and dispatches zero model calls", async () => {
    const db = openTestSidecar();
    try {
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-idle-empty",
        nowMs: 100,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(result).toMatchObject({
        eligible: false,
        idleEligible: false,
        reason: "empty_house",
        thoughtCalls: 0,
        semanticAbsenceClaim: "yes",
      });
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("reports occupancy UNREACHABLE and never synthesizes empty_house", async () => {
    const db = openTestSidecar();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      db.exec("DROP TABLE mind_occupancy");
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId: "thread-idle-unreachable",
        nowMs: 100,
        runThought: async () => {
          calls += 1;
          return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
        },
      });

      expect(result).toMatchObject({
        eligible: false,
        idleEligible: false,
        reason: "occupancy_unreachable",
        thoughtCalls: 0,
        semanticAbsenceClaim: "no",
      });
      expect(result.reason).not.toBe("empty_house");
      expect(result.suppressedTriggers).toEqual([]);
      expect(calls).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        "[cognitive-v021] idle_occupancy_unreachable",
        expect.objectContaining({ conversationId: "thread-idle-unreachable" }),
      );
    } finally {
      warn.mockRestore();
      db.close();
    }
  });

  it("passes grounded occupancy to the injected normal Thought pipeline and accepts silence", async () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-idle-grounded";
      seedActiveOccupancy(db, conversationId);
      establishEpoch(db, 100);
      let calls = 0;
      const result = await tickIdleOpportunity(db, {
        conversationId,
        nowMs: 100,
        runThought: async (input) => {
          calls += 1;
          expect(input.trigger.kind).toBe("idle_opportunity");
          expect(input.occupancy).toEqual([
            expect.objectContaining({ concernId: `concern-${conversationId}`, status: "active" }),
          ]);
          expect(input.privateBudgetReservation.reservationId).toMatch(/^private-reservation:/);
          return {
            published: false,
            outboxId: null,
            thoughtModelAttempts: 1,
            settlement: { speech: { mode: "none" as const } },
          };
        },
      });

      expect(result).toMatchObject({
        eligible: true,
        idleEligible: true,
        reason: null,
        thoughtCalls: 1,
        semanticAbsenceClaim: "no",
      });
      expect(calls).toBe(1);
      expect(result.acceptedSettlements).toBe(0);
      expect(db.prepare(
        "SELECT state FROM private_budget_reservations WHERE conversation_id = ? ORDER BY reservation_id DESC LIMIT 1",
      ).get(conversationId)).toMatchObject({ state: "reconcile_required" });
    } finally {
      db.close();
    }
  });

  it("does not automatically send Discord or create a secondary idle loop/context composer", async () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-idle-private-only";
      seedActiveOccupancy(db, conversationId);
      establishEpoch(db, 100);
      const result = await tickIdleOpportunity(db, {
        conversationId,
        nowMs: 100,
        runThought: async () => ({
          published: false,
          outboxId: null,
          thoughtModelAttempts: 1,
          speechMode: "none" as const,
        }),
      });

      expect(result.thoughtCalls).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }

    const source = readFileSync(fileURLToPath(new URL("../idle.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toContain("buildThoughtInput(");
    expect(source).not.toContain("speech_outbox");
  });
});

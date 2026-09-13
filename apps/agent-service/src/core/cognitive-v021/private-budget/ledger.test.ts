import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitWake } from "../wake/ledger.js";
import {
  DEFAULT_PRIVATE_THOUGHT_POLICY,
  bindPrivateReservationInvocation,
  getPrivateBudgetProjection,
  getPrivateReservation,
  releasePrivateReservation,
  reservePrivateThought,
} from "./ledger.js";
import { reconcilePolicyClock } from "./policy-time-ledger.js";

const BASE = 1_000_000;

function db(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
}

function wake(sidecar: DatabaseSync, suffix: string, conversationId = "conversation:budget"): string {
  const admitted = admitWake(sidecar, {
    occurrenceId: `occurrence:budget:${suffix}`,
    triggerRef: `trigger:budget:${suffix}`,
    sourceKind: "idle",
    conversationId,
    cycleId: `cycle:budget:${suffix}`,
    capturedAuthorityRevision: 1,
    nowMs: BASE,
  });
  return admitted.wake.wakeId;
}

function establishEpoch(sidecar: DatabaseSync, policyId = "private-v1"): void {
  reconcilePolicyClock(sidecar, {
    policyId,
    wallClockNowMs: BASE,
    authorizationRef: "owner:budget-epoch",
  });
}

function reserve(sidecar: DatabaseSync, suffix: string, nowMs = BASE, policyId = "private-v1") {
  return reservePrivateThought(sidecar, {
    admissionId: `admission:budget:${suffix}`,
    wakeId: wake(sidecar, suffix),
    conversationId: "conversation:budget",
    policyId,
    wallClockNowMs: nowMs,
  });
}

describe("durable private budget ledger", () => {
  it("bootstraps a stable clock on genuinely fresh history and then atomically reserves one admission", () => {
    const sidecar = db();
    try {
      const wakeId = wake(sidecar, "epoch");
      // No clock row, zero policy reservations: bootstrap-and-admit (F0).
      const first = reservePrivateThought(sidecar, {
        admissionId: "admission:budget:epoch",
        wakeId,
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE,
      });
      expect(first.kind).toBe("reserved");
      if (first.kind !== "reserved") throw new Error("test_reservation_missing");
      expect(first.remaining).toBe(DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1);
      expect(sidecar.prepare("SELECT last_policy_now_ms, clock_state FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get()).toMatchObject({ last_policy_now_ms: BASE, clock_state: "stable" });
      const reserved = reservePrivateThought(sidecar, {
        admissionId: "admission:budget:epoch",
        wakeId,
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE,
      });
      expect(reserved.kind).toBe("existing");
      if (reserved.kind !== "existing") throw new Error("test_reservation_missing");
      expect(reserved.remaining).toBe(DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1);
      expect(reservePrivateThought(sidecar, {
        admissionId: "admission:budget:epoch",
        wakeId,
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE + 1,
      })).toMatchObject({ kind: "existing", remaining: DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1 });
      expect(getPrivateBudgetProjection(sidecar, {
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE + 1,
      })).toMatchObject({ source: "private_budget_ledger", clockState: "stable", consumingCount: 1, remaining: DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1 });
    } finally {
      sidecar.close();
    }
  });

  it("fails closed when reservation rows exist without a clock row (inconsistent history)", () => {
    const sidecar = db();
    try {
      const wakeId = wake(sidecar, "rows-without-clock");
      // Every genuine reservation is preceded, in the same transaction, by the
      // clock insert — so rows without a clock prove restore/clone/partial
      // loss. Seed that state directly (no clock row) and require refusal.
      sidecar.prepare(
        `INSERT INTO private_budget_reservations
          (reservation_id, admission_id, wake_id, conversation_id, policy_id, state,
           policy_time_ms, dispatch_truth, created_at_ms, updated_at_ms)
         VALUES ('reservation:seeded', 'admission:seeded', ?, 'conversation:budget',
                 'private-v1', 'held', ?, 'not_bound', ?, ?)`,
      ).run(wakeId, BASE, BASE, BASE);
      expect(reservePrivateThought(sidecar, {
        admissionId: "admission:budget:inconsistent",
        wakeId,
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE + 1,
      })).toEqual({ kind: "refused", reason: "clock_reconciliation", remaining: 0 });
      // Fail closed without writing state: no clock row is created, no new
      // reservation is minted, capacity is conserved.
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get() as { count: number }).count).toBe(0);
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations WHERE policy_id = 'private-v1'").get() as { count: number }).count).toBe(1);
      expect(getPrivateBudgetProjection(sidecar, {
        policyId: "private-v1",
        wallClockNowMs: BASE + 1,
      })).toMatchObject({ clockState: "clock_reconciliation", remaining: 0 });
    } finally {
      sidecar.close();
    }
  });

  it("enforces four reservations, refuses the fifth, and expires at the rolling boundary", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar);
      for (let index = 0; index < DEFAULT_PRIVATE_THOUGHT_POLICY.limit; index += 1) {
        expect(reserve(sidecar, `limit-${index}`, BASE).kind).toBe("reserved");
      }
      expect(reserve(sidecar, "limit-12", BASE + 100)).toEqual({ kind: "refused", reason: "capacity_exhausted", remaining: 0 });
      reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE + DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs, authorizationRef: "owner:rolling-boundary" });
      expect(reserve(sidecar, "boundary", BASE + DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs).kind).toBe("reserved");
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations WHERE state = 'expired'").get() as { count: number }).count).toBe(DEFAULT_PRIVATE_THOUGHT_POLICY.limit);
    } finally {
      sidecar.close();
    }
  });

  it("serializes the final slot and keeps policies independent", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar, "private-v1");
      establishEpoch(sidecar, "private-v2");
      for (let index = 0; index < DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1; index += 1) reserve(sidecar, `race-${index}`);
      expect(reserve(sidecar, "race-final-a").kind).toBe("reserved");
      expect(reserve(sidecar, "race-final-b").kind).toBe("refused");
      expect(reserve(sidecar, "separate-policy", BASE, "private-v2").kind).toBe("reserved");
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations WHERE policy_id = 'private-v1'").get() as { count: number }).count).toBe(DEFAULT_PRIVATE_THOUGHT_POLICY.limit);
    } finally {
      sidecar.close();
    }
  });

  it("blocks backward jumps beyond tolerance, then auto-exits on safe re-entry without lowering high-water", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar);
      expect(reserve(sidecar, "clock-stable", BASE + 100).kind).toBe("reserved");
      expect(reserve(sidecar, "clock-backward", BASE - DEFAULT_PRIVATE_THOUGHT_POLICY.clockDiscontinuityMs - 1)).toEqual({ kind: "refused", reason: "clock_reconciliation", remaining: 0 });
      expect((sidecar.prepare("SELECT last_policy_now_ms, clock_state FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get() as Record<string, unknown>)).toMatchObject({ last_policy_now_ms: BASE + 100, clock_state: "clock_reconciliation" });
      // Automatic exit: a later poll observes the wall clock back inside the
      // safe region (forward of high-water minus tolerance) and proceeds with
      // no operator action, keeping the high-water mark.
      expect(reserve(sidecar, "clock-auto-exit", BASE + 200).kind).toBe("reserved");
      expect((sidecar.prepare("SELECT last_policy_now_ms, clock_state FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get() as Record<string, unknown>)).toMatchObject({ last_policy_now_ms: BASE + 200, clock_state: "stable" });
      // Hourly polls never re-poison a stable clock: forward gaps stay stable.
      expect(reserve(sidecar, "clock-hourly", BASE + 200 + 3_600_000).kind).toBe("reserved");
      expect((sidecar.prepare("SELECT clock_state FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get() as Record<string, unknown>)).toMatchObject({ clock_state: "stable" });
      reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE - 10_000, authorizationRef: "owner:clock-review" });
      expect((sidecar.prepare("SELECT last_policy_now_ms, clock_state FROM private_budget_policy_clock WHERE policy_id = 'private-v1'").get() as Record<string, unknown>)).toMatchObject({ last_policy_now_ms: BASE + 200 + 3_600_000, clock_state: "stable" });
      expect(reserve(sidecar, "clock-after-review", BASE + 201 + 3_600_000).kind).toBe("reserved");
    } finally {
      sidecar.close();
    }
  });

  it("rejects a reservation whose wake belongs to another conversation", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar);
      const wakeId = wake(sidecar, "conversation", "conversation:other");
      expect(() => reservePrivateThought(sidecar, {
        admissionId: "admission:conversation-conflict",
        wakeId,
        conversationId: "conversation:budget",
        policyId: "private-v1",
        wallClockNowMs: BASE,
      })).toThrow("wake_conversation_conflict");
    } finally {
      sidecar.close();
    }
  });

  it("does not treat a released reservation as consuming capacity", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar);
      const first = reserve(sidecar, "release");
      if (first.kind !== "reserved") throw new Error("test_reservation_missing");
      bindPrivateReservationInvocation(sidecar, { reservationId: first.reservation.reservationId, invocationId: "invocation:release", attemptId: "attempt:release", nowMs: BASE });
      releasePrivateReservation(sidecar, { reservationId: first.reservation.reservationId, proofRef: "receipt:not-started", dispatchTruth: "not_started", invocationId: "invocation:release", attemptId: "attempt:release", nowMs: BASE });
      expect(getPrivateReservation(sidecar, first.reservation.reservationId)?.state).toBe("released");
      expect(reserve(sidecar, "after-release").kind).toBe("reserved");
    } finally {
      sidecar.close();
    }
  });

  it("counts the 4/hour ceiling globally across conversations (no thread-switch bypass)", () => {
    const sidecar = db();
    try {
      const reserveOn = (suffix: string, conversationId: string, nowMs = BASE) => reservePrivateThought(sidecar, {
        admissionId: `admission:budget:global:${suffix}`,
        wakeId: wake(sidecar, `global:${suffix}`, conversationId),
        conversationId,
        policyId: "private-v1",
        wallClockNowMs: nowMs,
      });
      expect(reserveOn("a-1", "conversation:alpha").kind).toBe("reserved");
      expect(reserveOn("a-2", "conversation:alpha").kind).toBe("reserved");
      expect(reserveOn("b-1", "conversation:beta").kind).toBe("reserved");
      expect(reserveOn("b-2", "conversation:beta").kind).toBe("reserved");
      // Four admissions across two threads exhaust the ONE global allowance:
      // the fifth is refused on either conversation.
      expect(reserveOn("a-3", "conversation:alpha")).toEqual({ kind: "refused", reason: "capacity_exhausted", remaining: 0 });
      expect(reserveOn("b-3", "conversation:beta")).toEqual({ kind: "refused", reason: "capacity_exhausted", remaining: 0 });
      // The projection is policy-scoped: conversationId is accepted for
      // diagnostic continuity but does not change the global count.
      expect(getPrivateBudgetProjection(sidecar, { policyId: "private-v1", wallClockNowMs: BASE })).toMatchObject({ consumingCount: 4, remaining: 0 });
      expect(getPrivateBudgetProjection(sidecar, { conversationId: "conversation:alpha", policyId: "private-v1", wallClockNowMs: BASE })).toMatchObject({ consumingCount: 4, remaining: 0 });
      expect(getPrivateBudgetProjection(sidecar, { conversationId: "conversation:unseen", policyId: "private-v1", wallClockNowMs: BASE })).toMatchObject({ consumingCount: 4, remaining: 0 });
    } finally {
      sidecar.close();
    }
  });

  it("admits across sparse polling gaps without ever entering reconciliation", () => {
    const sidecar = db();
    try {
      // T0 bootstrap admits on genuinely fresh history.
      expect(reserve(sidecar, "sparse-t0", BASE).kind).toBe("reserved");
      // T+60m / T+6h / T+24h forward gaps are normal inactivity: admit, age
      // the window, never reconcile.
      expect(reserve(sidecar, "sparse-60m", BASE + 3_600_000).kind).toBe("reserved");
      expect(reserve(sidecar, "sparse-6h", BASE + 21_600_000).kind).toBe("reserved");
      expect(reserve(sidecar, "sparse-24h", BASE + 86_400_000).kind).toBe("reserved");
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_policy_clock WHERE clock_state = 'clock_reconciliation'").get() as { count: number }).count).toBe(0);
      expect(getPrivateBudgetProjection(sidecar, { policyId: "private-v1", wallClockNowMs: BASE + 86_400_000 })).toMatchObject({ clockState: "stable" });
    } finally {
      sidecar.close();
    }
  });

  it("treats a restored old sidecar with a current wall clock as ordinary forward time (threat-model-A honesty)", () => {
    const sidecar = db();
    try {
      establishEpoch(sidecar);
      expect(reserve(sidecar, "restore-before", BASE).kind).toBe("reserved");
      // Snapshot restore is undetectable from inside the sidecar (no
      // cross-database anchor exists by design): old high-water + old rows +
      // current wall clock appears as ordinary forward time. This must admit
      // (aging the window), never falsely reconcile.
      expect(reserve(sidecar, "restore-after", BASE + 30 * 86_400_000).kind).toBe("reserved");
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_policy_clock WHERE clock_state = 'clock_reconciliation'").get() as { count: number }).count).toBe(0);
    } finally {
      sidecar.close();
    }
  });

  it("serializes the final slot across two independent Node processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-w7-budget-"));
    const databasePath = join(directory, "sidecar.sqlite");
    const parent = openCognitiveSidecarDb(new DatabaseSync(databasePath), { dataPlane: { kind: "isolated" } });
    const workers = ["worker-a", "worker-b"].map((suffix) => admitWake(parent, {
      occurrenceId: `occurrence:budget:multiprocess:${suffix}`,
      triggerRef: `trigger:budget:multiprocess:${suffix}`,
      sourceKind: "idle",
      conversationId: "conversation:multiprocess",
      cycleId: `cycle:budget:multiprocess:${suffix}`,
      capturedAuthorityRevision: 1,
      nowMs: BASE + 1,
    }).wake.wakeId);
    try {
      establishEpoch(parent, "private-v1");
      for (let index = 0; index < DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1; index += 1) {
        const admitted = admitWake(parent, {
          occurrenceId: `occurrence:budget:multiprocess:seed-${index}`,
          triggerRef: `trigger:budget:multiprocess:seed-${index}`,
          sourceKind: "idle",
          conversationId: "conversation:multiprocess",
          cycleId: `cycle:budget:multiprocess:seed-${index}`,
          capturedAuthorityRevision: 1,
          nowMs: BASE,
        });
        expect(reservePrivateThought(parent, {
          admissionId: `admission:budget:multiprocess:seed-${index}`,
          wakeId: admitted.wake.wakeId,
          conversationId: "conversation:multiprocess",
          policyId: "private-v1",
          wallClockNowMs: BASE,
        })).toMatchObject({ kind: "reserved" });
      }
      parent.close();

      const childSource = `
import { DatabaseSync } from "node:sqlite";
import { reservePrivateThought } from "./src/core/cognitive-v021/private-budget/ledger.ts";
const [databasePath, suffix, wakeId] = process.argv.slice(1);
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA busy_timeout = 10000");
try {
  const result = reservePrivateThought(db, {
    admissionId: "admission:budget:multiprocess:" + suffix,
    wakeId,
    conversationId: "conversation:multiprocess",
    policyId: "private-v1",
    wallClockNowMs: ${BASE + 1},
  });
  process.stdout.write(JSON.stringify({ suffix, kind: result.kind, reason: result.kind === "refused" ? result.reason : null }));
} finally {
  db.close();
}
`;
      const results = await Promise.all(workers.map((wakeId, index) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource, databasePath, `worker-${index === 0 ? "a" : "b"}`, wakeId], {
          cwd: join(process.cwd()),
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      })));
      expect(results.every((result) => result.code === 0)).toBe(true);
      const traces = results.map((result) => JSON.parse(result.stdout) as { suffix: string; kind: string; reason: string | null });
      expect(traces.filter((trace) => trace.kind === "reserved")).toHaveLength(1);
      expect(traces.filter((trace) => trace.kind === "refused" && trace.reason === "capacity_exhausted")).toHaveLength(1);
    } finally {
      try { parent.close(); } catch { /* already closed before child processes */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

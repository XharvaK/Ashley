import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  COGNITIVE_SIDECAR_SCHEMA_V1,
  COGNITIVE_SIDECAR_SCHEMA_V2,
  COGNITIVE_SIDECAR_SCHEMA_V3,
  COGNITIVE_SIDECAR_SCHEMA_V4,
  COGNITIVE_SIDECAR_SCHEMA_V5,
  COGNITIVE_SIDECAR_SCHEMA_V6,
} from "../sidecar/schema.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../types.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import {
  advanceDeferredFrontierEvidence,
  claimDueDeferredFrontier,
  createDeferredFrontierInTransaction,
  exhaustDeferredFrontier,
  getActiveDeferredFrontier,
  getDeferredFrontier,
  listDueDeferredFrontiers,
  rescheduleDeferredFrontier,
  resolveDeferredFrontier,
} from "./ledger.js";

function createV6Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
  db.exec(
    `INSERT INTO cognitive_sidecar_meta
       (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
     VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 1, 1)`,
  );
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V4);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V5);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V6);
  db.exec("PRAGMA user_version = 6");
  return db;
}

function openMigratedDb(): DatabaseSync {
  const v6 = createV6Database();
  return openCognitiveSidecarDb(v6, { dataPlane: { kind: "isolated" } });
}

describe("Wave 1B: Durable Frontier Lifecycle & Migration 007", () => {
  it("migrates from v006 fixture through the current migration chain and establishes exact schema_version", () => {
    const db = openMigratedDb();
    const meta = db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number };
    expect(meta.schema_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);

    const tableInfo = db.prepare("PRAGMA table_info(deferred_reactive_frontiers)").all() as Array<{ name: string }>;
    expect(tableInfo.map((col) => col.name)).toEqual([
      "frontier_id",
      "conversation_id",
      "cycle_id",
      "generation",
      "state",
      "next_eligible_at_ms",
      "capacity_deadline_at_ms",
      "latest_evidence_row_id",
      "claim_token",
      "lease_expires_at_ms",
      "attempt_count",
      "created_at_ms",
      "updated_at_ms",
      "terminal_reason",
    ]);
    db.close();
  });

  it("creates a waiting frontier and enforces nextEligibleAtMs > createdAtMs", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const frontier = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 35_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });
    expect(frontier).toMatchObject({
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      state: "waiting",
      nextEligibleAtMs: 1_035_000,
      capacityDeadlineAtMs: 1_120_000,
      latestEvidenceRowId: "ev:1",
      attemptCount: 0,
    });

    expect(() =>
      createDeferredFrontierInTransaction(db, {
        conversationId: "conv:2",
        cycleId: "cycle:2",
        generation: 1,
        nextEligibleAtMs: nowMs, // non-forward hint
        latestEvidenceRowId: "ev:2",
        nowMs,
      }),
    ).toThrow(/non_forward_hint/);
    db.close();
  });

  it("rejects duplicate active frontiers for the same conversation via partial unique index", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 10_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });

    expect(() =>
      createDeferredFrontierInTransaction(db, {
        conversationId: "conv:1",
        cycleId: "cycle:2",
        generation: 2,
        nextEligibleAtMs: nowMs + 20_000,
        latestEvidenceRowId: "ev:2",
        nowMs,
      }),
    ).toThrow();
    db.close();
  });

  it("allows historical resolved frontier and subsequent new active frontier for same conversation", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const f1 = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 10_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });

    // Claim and resolve f1
    expect(claimDueDeferredFrontier(db, f1.frontierId, "claim:1", 5_000, nowMs + 10_000).claimed).toBe(true);
    expect(resolveDeferredFrontier(db, f1.frontierId, nowMs + 12_000)).toBe(true);

    const check = getDeferredFrontier(db, f1.frontierId);
    expect(check?.state).toBe("resolved");

    // New frontier f2 in the same conversation is allowed!
    const f2 = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:3",
      generation: 3,
      nextEligibleAtMs: nowMs + 50_000,
      latestEvidenceRowId: "ev:3",
      nowMs: nowMs + 20_000,
    });
    expect(f2.state).toBe("waiting");
    expect(f2.frontierId).not.toBe(f1.frontierId);
    db.close();
  });

  it("atomic conditional claim ensures only one claimant succeeds", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const frontier = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 10_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });

    // Before nextEligibleAtMs -> claim fails
    const earlyClaim = claimDueDeferredFrontier(db, frontier.frontierId, "token:early", 5_000, nowMs + 5_000);
    expect(earlyClaim.claimed).toBe(false);

    // At or after nextEligibleAtMs -> first claim succeeds
    const firstClaim = claimDueDeferredFrontier(db, frontier.frontierId, "token:first", 5_000, nowMs + 10_000);
    expect(firstClaim.claimed).toBe(true);
    expect(firstClaim.frontier?.state).toBe("running");
    expect(firstClaim.frontier?.claimToken).toBe("token:first");
    expect(firstClaim.frontier?.attemptCount).toBe(1);

    // Second concurrent claim with active lease fails
    const secondClaim = claimDueDeferredFrontier(db, frontier.frontierId, "token:second", 5_000, nowMs + 11_000);
    expect(secondClaim.claimed).toBe(false);

    db.close();
  });

  it("reclaims expired running lease but does not reclaim resolved or exhausted frontiers", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const frontier = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 10_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });

    // Worker 1 claims with 2s lease
    expect(claimDueDeferredFrontier(db, frontier.frontierId, "token:1", 2_000, nowMs + 10_000).claimed).toBe(true);

    // Lease expires at 10_000 + 2_000 = 12_000. At 13_000, Worker 2 reclaims expired lease
    const reclaim = claimDueDeferredFrontier(db, frontier.frontierId, "token:2", 5_000, nowMs + 13_000);
    expect(reclaim.claimed).toBe(true);
    expect(reclaim.frontier?.claimToken).toBe("token:2");
    expect(reclaim.frontier?.attemptCount).toBe(2);

    // Resolve frontier
    resolveDeferredFrontier(db, frontier.frontierId, nowMs + 14_000);

    // Reclaim on resolved fails
    expect(claimDueDeferredFrontier(db, frontier.frontierId, "token:3", 5_000, nowMs + 20_000).claimed).toBe(false);

    db.close();
  });

  it("advances evidence without altering nextEligibleAtMs", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const frontier = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 35_000,
      latestEvidenceRowId: "ev:A",
      nowMs,
    });

    const advanced = advanceDeferredFrontierEvidence(db, frontier.frontierId, "ev:B", nowMs + 10_000);
    expect(advanced).toBe(true);

    const updated = getDeferredFrontier(db, frontier.frontierId);
    expect(updated?.latestEvidenceRowId).toBe("ev:B");
    expect(updated?.nextEligibleAtMs).toBe(nowMs + 35_000); // Unchanged!
    db.close();
  });

  it("rescheduling enforces 120s ceiling and transitions to exhausted when exceeded", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;
    const frontier = createDeferredFrontierInTransaction(db, {
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: nowMs + 35_000,
      latestEvidenceRowId: "ev:A",
      nowMs,
    });

    // Claim at 35s
    expect(claimDueDeferredFrontier(db, frontier.frontierId, "token:1", 5_000, nowMs + 35_000).claimed).toBe(true);

    // Reschedule at 36s for +30s (66s total) -> valid
    const resched1 = rescheduleDeferredFrontier(db, frontier.frontierId, nowMs + 66_000, nowMs + 36_000);
    expect(resched1.outcome).toBe("rescheduled");

    // Claim at 66s
    expect(claimDueDeferredFrontier(db, frontier.frontierId, "token:2", 5_000, nowMs + 66_000).claimed).toBe(true);

    // Attempt reschedule at 121s (past 120s deadline of 1_120_000)
    const resched2 = rescheduleDeferredFrontier(db, frontier.frontierId, nowMs + 130_000, nowMs + 121_000);
    expect(resched2.outcome).toBe("exhausted");
    expect(resched2.reason).toBe("capacity_wait_max_duration_exceeded");

    const check = getDeferredFrontier(db, frontier.frontierId);
    expect(check?.state).toBe("exhausted");
    db.close();
  });

  it("restart discovery lists due waiting frontiers and skips future waiting frontiers", () => {
    const db = openMigratedDb();
    const nowMs = 1_000_000;

    // Frontier 1 is due at 1_010_000
    createDeferredFrontierInTransaction(db, {
      frontierId: "f1",
      conversationId: "conv:1",
      cycleId: "cycle:1",
      generation: 1,
      nextEligibleAtMs: 1_010_000,
      latestEvidenceRowId: "ev:1",
      nowMs,
    });

    // Frontier 2 is due at 1_050_000 (in the future)
    createDeferredFrontierInTransaction(db, {
      frontierId: "f2",
      conversationId: "conv:2",
      cycleId: "cycle:2",
      generation: 1,
      nextEligibleAtMs: 1_050_000,
      latestEvidenceRowId: "ev:2",
      nowMs,
    });

    // At 1_015_000 (after restart), listDueDeferredFrontiers finds f1 only
    const due = listDueDeferredFrontiers(db, 1_015_000);
    expect(due.map((f) => f.frontierId)).toEqual(["f1"]);

    db.close();
  });

  it("B6: missing mandatory deferred_reactive_frontiers table throws/fails closed instead of returning null", () => {
    const unmigratedV6 = createV6Database();
    expect(() => getActiveDeferredFrontier(unmigratedV6, "conv:1")).toThrow(/no such table/i);
    unmigratedV6.close();

    const emptyDb = new DatabaseSync(":memory:");
    expect(() => getActiveDeferredFrontier(emptyDb, "conv:1")).toThrow(/no such table/i);
    emptyDb.close();
  });
});

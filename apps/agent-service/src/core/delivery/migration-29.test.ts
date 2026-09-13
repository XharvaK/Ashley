import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import { MIGRATION_29_PHASE_LIFECYCLE_DDL } from "./migration-29.js";
import {
  initializePhaseLifecycle,
  parsePhaseLifecycleJson,
  readPhaseLifecycle,
  recordPhaseLifecycle,
  selectPhaseLifecycleBranch,
  deadlineOffsets,
  PHASE_LIFECYCLE_MAX_DEADLINE_KEYS,
} from "./phase-lifecycle.js";
import {
  createTurnDeadlinePlan,
  PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY,
} from "./turn-deadline-plan.js";
import { claimReactiveDelivery, getDeliveryReservation } from "./store.js";

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number })
      .user_version ?? 0,
  );
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((row) => row.name === column);
}

describe("nuclear schema v29 phase lifecycle telemetry", () => {
  it("installs Migration 29 on fresh databases", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        columnExists(db, "delivery_reservations", "phase_lifecycle_json"),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it("migrates a schema-28 source without changing historical reservation meaning", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    try {
      const claim = claimReactiveDelivery(nuclear, {
        ownerId: "doc",
        channel: "discord",
        mergedUserText: "historical row",
        inboundDiscordMessageIds: ["historical-28"],
        finalFragmentReceivedAtMs: 1_000,
        nowMs: 1_000,
      });
      if (claim.kind !== "claimed") throw new Error("claim failed");

      nuclear.exec(
        "ALTER TABLE delivery_reservations DROP COLUMN phase_lifecycle_json",
      );
      nuclear.exec("PRAGMA user_version = 28");
      continuity
        .prepare(
          "UPDATE lineage_state SET nuclear_schema_version = 28 WHERE id = 1",
        )
        .run();
      const lineageId = (
        nuclear.prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1").get() as {
          lineage_id: string;
        }
      ).lineage_id;
      beginNuclearMigration(continuity, {
        from: 28,
        to: 29,
        lineageId,
        buildIdentity: currentBuildIdentity(),
      });

      expect(getPendingNuclearMigration(continuity)).toMatchObject({
        from: 28,
        to: 29,
      });
      openNuclearDb(nuclear, { continuity });

      expect(schemaVersion(nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(continuity)).toBeNull();
      const historical = getDeliveryReservation(nuclear, claim.reservation.id);
      expect(historical?.phaseLifecycle).toBeNull();
    } finally {
      nuclear.close();
      continuity.close();
    }
  });

  it("applies the authorized one-column DDL directly", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE delivery_reservations (id INTEGER PRIMARY KEY)");
    db.exec(MIGRATION_29_PHASE_LIFECYCLE_DDL);
    expect(
      columnExists(db, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(true);
    db.close();
  });
});

describe("bounded delivery-owned phase lifecycle", () => {
  it("establishes the immutable plan and lifecycle in the reactive reservation claim", () => {
    const admittedAtMs = 30_000;
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const claim = claimReactiveDelivery(db, {
        ownerId: "doc",
        channel: "discord",
        mergedUserText: "ordinary turn",
        inboundDiscordMessageIds: ["plan-at-claim"],
        finalFragmentReceivedAtMs: admittedAtMs,
        nowMs: admittedAtMs,
      });
      if (claim.kind !== "claimed") throw new Error("claim failed");

      expect(claim.deadlinePlan.admittedAtMs).toBe(admittedAtMs);
      expect(Object.isFrozen(claim.deadlinePlan)).toBe(true);
      expect(claim.reservation.firstBubbleDeadlineAt).toBe(
        new Date(admittedAtMs + 125_000).toISOString(),
      );
      expect(claim.reservation.generationLeaseExpiresAt).toBe(
        new Date(admittedAtMs + 89_447).toISOString(),
      );
      expect(claim.reservation.phaseLifecycle).toMatchObject({
        version: 1,
        selectedBranch: null,
        phases: { admission: { state: "admitted" } },
      });
    } finally {
      db.close();
    }
  });

  it("round-trips a versioned plan summary and bounded phase facts", () => {
    const admittedAtMs = 10_000;
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const claim = claimReactiveDelivery(db, {
        ownerId: "doc",
        channel: "discord",
        mergedUserText: "inspect package.json",
        inboundDiscordMessageIds: ["phase-lifecycle"],
        finalFragmentReceivedAtMs: admittedAtMs,
        nowMs: admittedAtMs,
      });
      if (claim.kind !== "claimed") throw new Error("claim failed");
      const plan = createTurnDeadlinePlan(
        admittedAtMs,
        PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY,
      );

      initializePhaseLifecycle(db, claim.reservation.id, plan);
      selectPhaseLifecycleBranch(
        db,
        claim.reservation.id,
        "project_inspection",
        admittedAtMs + 100,
      );
      recordPhaseLifecycle(db, {
        reservationId: claim.reservation.id,
        phase: "continuation",
        event: "skipped",
        atMs: admittedAtMs + 17_000,
        statusCode: "continuation_deadline_expired",
      });

      const lifecycle = readPhaseLifecycle(db, claim.reservation.id);
      expect(lifecycle).toMatchObject({
        version: 1,
        planVersion: "phase-budget-v2-m2-preparation-39447",
        qualification: "unqualified",
        selectedBranch: "project_inspection",
        selectedAtOffsetMs: 100,
        phases: {
          admission: { state: "admitted", admittedOffsetMs: 0 },
          continuation: {
            state: "skipped",
            finishedOffsetMs: 17_000,
            statusCode: "continuation_deadline_expired",
          },
        },
      });
      expect(lifecycle?.deadlineOffsetsMs.initialThought).toBe(6_000);
      expect(lifecycle?.deadlineOffsetsMs.projectInspectionPreparation).toBe(
        45_447,
      );
      expect(lifecycle?.deadlineOffsetsMs.projectInspectionContinuation).toBe(
        61_447,
      );
      expect(
        lifecycle?.deadlineOffsetsMs.projectInspectionChildTermination,
      ).toBeLessThan(
        lifecycle?.deadlineOffsetsMs.projectInspectionSettlement ?? 0,
      );
      expect(
        lifecycle?.deadlineOffsetsMs.projectInspectionPreparation,
      ).toBeLessThan(
        lifecycle?.deadlineOffsetsMs["projectInspectionChild:project.read_file"] ??
          0,
      );
      expect(lifecycle?.deadlineOffsetsMs).toMatchObject({
        softResponsiveness: 5_000,
        projectInspectionPerception: 81_447,
        projectInspectionExpression: 85_447,
        projectInspectionGeneration: 89_447,
        externalTransport: 120_000,
        firstBubbleReceipt: 125_000,
        deliveryFinal: 245_000,
      });

      recordPhaseLifecycle(db, {
        reservationId: claim.reservation.id,
        phase: "project_inspection",
        event: "cancellation_requested",
        atMs: admittedAtMs + 16_000,
      });
      const cancellation = readPhaseLifecycle(db, claim.reservation.id);
      expect(cancellation?.phases.project_inspection).toMatchObject({
        cancellationRequested: true,
      });
      expect(cancellation?.phases.project_inspection)
        .not.toHaveProperty("cancellationAcknowledged");
    } finally {
      db.close();
    }
  });

  it("bounds codes and rejects raw text instead of persisting it", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const claim = claimReactiveDelivery(db, {
        ownerId: "doc",
        channel: "discord",
        mergedUserText: "OWNER_PRIVATE_TEXT",
        inboundDiscordMessageIds: ["phase-privacy"],
        finalFragmentReceivedAtMs: 20_000,
        nowMs: 20_000,
      });
      if (claim.kind !== "claimed") throw new Error("claim failed");
      initializePhaseLifecycle(
        db,
        claim.reservation.id,
        createTurnDeadlinePlan(20_000),
      );
      recordPhaseLifecycle(db, {
        reservationId: claim.reservation.id,
        phase: "project_inspection",
        event: "settled",
        atMs: 21_000,
        statusCode:
          "provider said OWNER_PRIVATE_TEXT /srv/private/project and raw evidence",
      });

      const raw = (
        db
          .prepare(
            "SELECT phase_lifecycle_json FROM delivery_reservations WHERE id = ?",
          )
          .get(claim.reservation.id) as { phase_lifecycle_json: string }
      ).phase_lifecycle_json;
      expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(8_192);
      expect(raw).not.toContain("OWNER_PRIVATE_TEXT");
      expect(raw).not.toContain("/srv/private/project");
      expect(raw).not.toContain("raw evidence");
      expect(readPhaseLifecycle(db, claim.reservation.id)?.phases.project_inspection)
        .toMatchObject({ statusCode: "unclassified_error" });
    } finally {
      db.close();
    }
  });

  it("reads null, malformed, and schema-28 lifecycle values safely", () => {
    expect(parsePhaseLifecycleJson(null)).toBeNull();
    expect(parsePhaseLifecycleJson("not-json")).toBeNull();
    expect(parsePhaseLifecycleJson(JSON.stringify({ version: 99 }))).toBeNull();
  });

  it("M3+M4 deadline key count exceeds 40 and stays under the 64 parser ceiling", () => {
    const plan = createTurnDeadlinePlan(
      1_000_000,
      PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY,
    );
    const keys = Object.keys(deadlineOffsets(plan));
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.length).toBeLessThanOrEqual(PHASE_LIFECYCLE_MAX_DEADLINE_KEYS);
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < PHASE_LIFECYCLE_MAX_DEADLINE_KEYS + 1; i++) {
      tooMany[`k${i}`] = 1;
    }
    expect(
      parsePhaseLifecycleJson(
        JSON.stringify({
          version: 1,
          planVersion: "x",
          qualification: "unqualified",
          selectedBranch: null,
          selectedAtOffsetMs: null,
          deadlineOffsetsMs: tooMany,
          phases: {},
        }),
      ),
    ).toBeNull();
  });
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../../core/db.js";
import { resolveActiveThread } from "../../../core/memory/threads.js";
import { initObservabilitySchema } from "../thought/diagnostics.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { createSchedule } from "./periodic-schedule.js";
import {
  buildProactiveOperatorStatus,
  type LegacyProactiveStatus,
} from "./operator-status.js";
import { openTestSidecar } from "../test-support.js";

const legacy: LegacyProactiveStatus = {
  enabled: true,
  paused: false,
  sentToday: 0,
  maxPerDay: 10,
  lastSentAt: null,
  minIdleHours: 2,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proactive operator status", () => {
  it("reads periodic truth and occupied concerns without mutating the nuclear thread", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "1");
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const observabilityDb = new DatabaseSync(":memory:");
    initObservabilitySchema(observabilityDb);
    try {
      const conversationId = resolveActiveThread(nuclear, "doc");
      appendOwnerUtterance(sidecar, {
        conversationId,
        text: "keep the compiler experiment in view",
        nowMs: 100,
      });
      sidecar.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES (?, ?, ?, '[]', ?, NULL, 'active', 'snapshot', NULL)`,
      ).run(
        "concern-operator-status",
        conversationId,
        "keep the compiler experiment in view",
        JSON.stringify({ status: "asserted", reliability: "owner_supplied" }),
      );
      sidecar.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, ?, 'active', 10, 'cycle-status', 1)`,
      ).run(conversationId, "concern-operator-status");
      const schedule = createSchedule(sidecar, { authorityEpoch: 1, nowMs: 100 });
      const before = nuclear.prepare(
        "SELECT updated_at FROM mem_threads WHERE id = ?",
      ).get(conversationId);

      const status = buildProactiveOperatorStatus({
        sidecar,
        nuclear,
        observabilityDb,
        ownerId: "doc",
        legacy,
        nowMs: 200,
      });

      expect(status).toMatchObject({
        statusAvailability: "available",
        legacyProactiveEnabled: true,
        periodicCognitionEnabled: true,
        periodicScheduleState: "waiting",
        nextEligibleAt: new Date(schedule.nextEligibleAtMs).toISOString(),
        activeConversationId: conversationId,
        lastOwnerEvidenceAt: new Date(100).toISOString(),
        eligibleOccupiedConcernCount: 1,
        lastPeriodicOccurrence: null,
        lastProactiveThought: null,
        lastProactiveDelivery: null,
      });
      expect(status).not.toHaveProperty("lastUserMessageAt");
      expect(status.lastInitiativePreference).toBeNull();
      expect(nuclear.prepare(
        "SELECT updated_at FROM mem_threads WHERE id = ?",
      ).get(conversationId)).toEqual(before);
    } finally {
      observabilityDb.close();
      nuclear.close();
      sidecar.close();
    }
  });

  it("surfaces P2 shadow stance from the latest accepted settlement without the raw reason", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const observabilityDb = new DatabaseSync(":memory:");
    initObservabilitySchema(observabilityDb);
    try {
      const conversationId = resolveActiveThread(nuclear, "doc");
      sidecar.prepare(
        `INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
         VALUES (?, ?, ?, ?)`,
      ).run(
        "settlement-preference",
        "cycle-preference",
        1,
        JSON.stringify({
          settlementId: "settlement-preference",
          cycleId: "cycle-preference",
          interactionIntent: "initiate",
          initiativePreference: { stance: "willing", reason: "The Owner asked for a check-in." },
        }),
      );
      const status = buildProactiveOperatorStatus({
        sidecar,
        nuclear,
        observabilityDb,
        ownerId: "doc",
        legacy,
        nowMs: 200,
      });
      expect(status.lastInitiativePreference).toEqual({
        stance: "willing",
        settlementId: "settlement-preference",
        cycleId: "cycle-preference",
      });
      expect(JSON.stringify(status)).not.toContain("The Owner asked for a check-in.");
    } finally {
      observabilityDb.close();
      nuclear.close();
      sidecar.close();
    }
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { applyWorkingContextDelta } from "../evidence/working-context.js";
import { putInFlight } from "../effect/in-flight.js";
import { finishWake } from "../wake/ledger.js";
import { openTestSidecar } from "../test-support.js";
import type { CommitmentProposal } from "../../relationship/commitment-admission.js";
import {
  persistCommitmentProposals,
  settlePersistedCommitmentProposals,
} from "../../relationship/commitment-admission.js";
import {
  matureFutureTriggerToWake,
  scheduleFutureTrigger,
} from "./future-triggers.js";
import { executeTemporalControl } from "./temporal-control.js";

const ownerId = "owner-temporal";
const nowMs = Date.parse("2026-09-27T12:00:00.000Z");

function seedConcern(db: ReturnType<typeof openTestSidecar>, id: string): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, cognitive_status, snapshot_hash, updated_cycle)
     VALUES (?, 'thread-temporal', 'bounded temporal concern', '[]', '{}', NULL, 'active', 'snapshot-1', NULL)`,
  ).run(id);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES ('thread-temporal', ?, 'active', 10, 'cycle-seed', 1)`,
  ).run(id);
}

function schedule(id: string, db: ReturnType<typeof openTestSidecar>): void {
  scheduleFutureTrigger(db, {
    triggerId: id,
    conversationId: "thread-temporal",
    concernId: "concern-temporal",
    snapshotHash: "snapshot-1",
    dueAtMs: nowMs,
    payload: { purpose: "revisit this bounded concern" },
  });
}

function commitmentProposal(): CommitmentProposal {
  return {
    ordinal: 0,
    action: "send the Owner a bounded temporal update",
    beneficiary: "owner",
    destination: { kind: "owner_private" },
    temporal: { kind: "exact", atMs: nowMs + 60_000 },
    realizationClause: "I will send the Owner a bounded temporal update.",
    thoughtCycle: { cycleId: "cycle-temporal", attemptId: "attempt-temporal" },
  };
}

function directiveItem(id: string, sourceRowId: string): Record<string, unknown> {
  return {
    id,
    conversationId: "thread-temporal",
    type: "owner_teaching",
    text: "Keep this instruction bounded.",
    concernId: null,
    sourceTurnIds: [sourceRowId],
    status: "active",
    supersedesId: null,
    interpretationEnvelope: {
      kind: "directive_interpretation",
      support: [{ kind: "conversation_text_span", evidenceRowId: sourceRowId, start: 0, end: 7, quote: "keep it" }],
      audience: { kind: "unknown" },
      applicability: {
        subject: "Ashley",
        target: "this conversation",
        conversationId: "thread-temporal",
        concernId: null,
      },
      boundaryBasis: { temporal: "inferred" },
      applicabilityInterval: { until: "unknown" },
      conditions: { text: "", unresolved: false },
      derivationParents: [],
      revisionOf: null,
      revisionEvidenceRefs: [],
    },
  };
}

describe("CAM-W4-P3 owner temporal control", () => {
  it("lists motivated/admitted commitments and cancels a pending trigger without Thought", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedConcern(sidecar, "concern-temporal");
      schedule("future-cancel", sidecar);
      persistCommitmentProposals(nuclear, "temporal-commitment", [commitmentProposal()]);
      settlePersistedCommitmentProposals(nuclear, "temporal-commitment", { ownerId, nowMs, enabled: true });

      const listed = executeTemporalControl(sidecar, nuclear, ownerId, { operation: "list" });
      expect(listed?.records).toMatchObject({
        commitments: [expect.objectContaining({ id: "cmt:temporal-commitment:0", status: "admitted" })],
      });

      const admitted = matureFutureTriggerToWake(sidecar, "future-cancel", { nowMs });
      expect(admitted?.wake.state).toBe("pending");
      const cancelled = executeTemporalControl(sidecar, nuclear, ownerId, {
        operation: "cancel",
        kind: "future_trigger",
        id: "future-cancel",
        nowMs: nowMs + 1,
      });
      expect(cancelled).toMatchObject({
        acknowledgement: "queued_cancelled",
        status: "cancelled",
        wakeState: "terminal",
      });
      expect(sidecar.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(admitted!.wake.wakeId))
        .toEqual({ state: "terminal", terminal_reason: "cancelled" });
      expect(executeTemporalControl(sidecar, nuclear, ownerId, {
        operation: "cancel",
        kind: "future_trigger",
        id: "future-cancel",
      })).toMatchObject({ acknowledgement: "already_cancelled" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reports unknown for an in-flight effect and never reports a completed effect as cancelled", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedConcern(sidecar, "concern-temporal");
      schedule("future-in-flight", sidecar);
      const inFlightWake = matureFutureTriggerToWake(sidecar, "future-in-flight", { nowMs })!.wake;
      const event = sidecar.prepare("SELECT id FROM inbox_events WHERE id = ?").get("future-trigger:future-in-flight") as { id: string };
      putInFlight(sidecar, {
        cycleId: inFlightWake.cycleId,
        generation: 1,
        wakeId: inFlightWake.wakeId,
        correlationId: "correlation-temporal",
        idempotencyKey: "idempotency-temporal",
        originEventId: event.id,
      });
      expect(executeTemporalControl(sidecar, nuclear, ownerId, {
        operation: "cancel",
        kind: "future_trigger",
        id: "future-in-flight",
        nowMs: nowMs + 1,
      })).toMatchObject({ acknowledgement: "effect_unknown", wakeState: "reconciling" });

      schedule("future-completed", sidecar);
      const completedWake = matureFutureTriggerToWake(sidecar, "future-completed", { nowMs })!.wake;
      finishWake(sidecar, completedWake.wakeId, null, "completed", nowMs + 1);
      expect(executeTemporalControl(sidecar, nuclear, ownerId, {
        operation: "cancel",
        kind: "future_trigger",
        id: "future-completed",
      })).toMatchObject({ acknowledgement: "effect_already_completed", status: "fired" });
      expect(sidecar.prepare("SELECT status FROM future_triggers WHERE trigger_id = ?").get("future-completed"))
        .toEqual({ status: "fired" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("withdraws one directive interpretation while preserving its source evidence", () => {
    const db = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const source = appendOwnerUtterance(db, {
        conversationId: "thread-temporal",
        text: "keep it bounded",
        nowMs,
        audienceAtCapture: "owner_private",
      });
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directiveItem("directive-temporal", source.rowId),
      } as never, { cycleId: "cycle-directive", generation: 1, nowMs: nowMs + 1 });

      const result = executeTemporalControl(db, nuclear, ownerId, {
        operation: "withdraw",
        kind: "directive",
        id: "directive-temporal",
      });
      expect(result).toMatchObject({ acknowledgement: "withdrawn", sourceReadable: true, record: { cancellationState: "withdrawn" } });
      expect(db.prepare("SELECT applicability_lifecycle, superseded, payload_json FROM working_context_items WHERE id = ?").get("directive-temporal"))
        .toMatchObject({ applicability_lifecycle: "withdrawn", superseded: 0, payload_json: expect.stringContaining(source.rowId) });
      expect(db.prepare("SELECT source_status, text FROM conversation_evidence_log WHERE row_id = ?").get(source.rowId))
        .toMatchObject({ source_status: "received", text: "keep it bounded" });
    } finally {
      db.close();
      nuclear.close();
    }
  });

  it("returns not-found without writing for an unknown exact id", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const before = sidecar.prepare("SELECT COUNT(*) AS count FROM future_triggers").get();
      expect(executeTemporalControl(sidecar, nuclear, ownerId, {
        operation: "cancel",
        kind: "future_trigger",
        id: "missing-exact-id",
      })).toBeNull();
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM future_triggers").get()).toEqual(before);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

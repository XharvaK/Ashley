import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitWake, beginConsequence, claimWake, finishWake, authorizeWake } from "./ledger.js";

function db(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
}

describe("durable wake ledger", () => {
  it("admits, claims, authorizes, and terminalizes one wake exactly once", () => {
    const sidecar = db();
    const admitted = admitWake(sidecar, {
      occurrenceId: "wake-occurrence:test", triggerRef: "turn-1", sourceKind: "inbox",
      conversationId: "conversation-1", cycleId: "cycle-1", capturedAuthorityRevision: 1, nowMs: 1,
    });
    expect(admitted.kind).toBe("created");
    const existing = admitWake(sidecar, {
      occurrenceId: "wake-occurrence:test", triggerRef: "turn-1", sourceKind: "inbox",
      conversationId: "conversation-1", cycleId: "cycle-1", capturedAuthorityRevision: 1, nowMs: 2,
    });
    expect(existing.kind).toBe("existing");
    const claimed = claimWake(sidecar, admitted.wake.wakeId, "worker-1", 3, 100);
    expect(claimed.leaseToken).toMatch(/^wake-lease:/);
    authorizeWake(sidecar, admitted.wake.wakeId, claimed.leaseToken, 4);
    const consequence = beginConsequence(sidecar, admitted.wake.wakeId, claimed.leaseToken, 1, 5);
    expect(consequence.chainId).toMatch(/^consequence:/);
    finishWake(sidecar, admitted.wake.wakeId, claimed.leaseToken, "completed", 6);
    expect(() => claimWake(sidecar, admitted.wake.wakeId, "worker-2", 7, 100)).toThrow("wake_terminal");
    sidecar.close();
  });

  it("rejects wake admission when conversation is occupied by active deferred frontier for another cycle", () => {
    const sidecar = db();
    const cycleN = "cycle-n";
    sidecar.prepare(
      `INSERT INTO cycle_records
         (cycle_id, conversation_id, generation, state, trigger_kind, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms, compose_log_ids_json)
       VALUES (?, 'conv-occ', 1, 'capacity_wait', 'owner_message', 1, 'v0.2.1', 100, 100, '[]')`,
    ).run(cycleN);
    sidecar.prepare(
      `INSERT INTO deferred_reactive_frontiers
         (frontier_id, conversation_id, cycle_id, generation, state,
            next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
            attempt_count, created_at_ms, updated_at_ms)
       VALUES ('f-occ', 'conv-occ', ?, 1, 'waiting', 200, 1000, 'ev-1', 0, 100, 100)`,
    ).run(cycleN);

    // Attempt admitWake for a different cycle M on same conversation
    expect(() => {
      admitWake(sidecar, {
        occurrenceId: "wake-m",
        triggerRef: "ev-2",
        sourceKind: "inbox",
        conversationId: "conv-occ",
        cycleId: "cycle-m",
        capturedAuthorityRevision: 1,
        nowMs: 150,
      });
    }).toThrow("conversation_occupied_by_frontier");

    const maxGen = sidecar.prepare("SELECT MAX(generation) AS maxGen FROM cycle_records WHERE conversation_id = ?").get("conv-occ") as { maxGen: number };
    expect(maxGen.maxGen).toBe(1);
    sidecar.close();
  });
});

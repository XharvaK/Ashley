import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import type { C3TerminalExperienceRecord } from "../../failure/types.js";
import { adaptC3Experiences } from "../c3-adapter.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { buildThoughtInput } from "../input.js";

const identity = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capability = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function insertRecord(
  db: DatabaseSync,
  overrides: Partial<C3TerminalExperienceRecord> = {},
): C3TerminalExperienceRecord {
  const record: C3TerminalExperienceRecord = {
    experienceId: "c3:test:experience",
    obligationFrontierId: null,
    cycleId: "cycle-current",
    generation: 2,
    attemptId: "attempt-1",
    attemptLineageJson: JSON.stringify({
      dispatchTruth: "not_started",
      errorCode: "provider_unavailable",
      stack: "Error: provider unavailable\n" + "at provider.call ".repeat(400),
    }),
    terminalPhase: "retry",
    failureClass: "attempts_exhausted",
    terminalDisposition: "terminal",
    publicationState: "unpublished",
    externalEffectTruth: "no_effect_proven",
    receiptRef: "durable_work_attempt:attempt-1",
    unresolvedState: 1,
    rawEvidenceRefsJson: JSON.stringify([
      { kind: "inbox_events", id: "event-1" },
      { kind: "durable_work_attempts", id: "attempt-1" },
      { kind: "system_notice_outbox", id: "notice-1" },
    ]),
    noticeId: "notice-1",
    occurredAtMs: 2_000,
    sourceDomainOwner: "retry",
    sourceCurrentnessRef: "cycle-current:generation:2",
    redacted: 0,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO c3_terminal_experiences
       (experience_id, obligation_frontier_id, cycle_id, generation, attempt_id,
        attempt_lineage_json, terminal_phase, failure_class, terminal_disposition,
        publication_state, external_effect_truth, receipt_ref, unresolved_state,
        raw_evidence_refs_json, notice_id, occurred_at_ms, source_domain_owner,
        source_currentness_ref, redacted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.experienceId,
    record.obligationFrontierId,
    record.cycleId,
    record.generation,
    record.attemptId,
    record.attemptLineageJson,
    record.terminalPhase,
    record.failureClass,
    record.terminalDisposition,
    record.publicationState,
    record.externalEffectTruth,
    record.receiptRef,
    record.unresolvedState,
    record.rawEvidenceRefsJson,
    record.noticeId,
    record.occurredAtMs,
    record.sourceDomainOwner,
    record.sourceCurrentnessRef,
    record.redacted,
  );
  return record;
}

function coverage(result: ReturnType<typeof adaptC3Experiences>) {
  return result.coverageManifest.domains.find((domain) => domain.domain === "failures_interruptions");
}

describe("C3 terminal experience C2 adapter", () => {
  it("projects a current unresolved source record with exact mechanical provenance", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-current",
        conversationId: "conversation-c3",
        triggerKind: "owner_message",
        triggerRef: "owner-c3",
        generation: 2,
        nowMs: 1,
      });
      const record = insertRecord(db);

      const result = adaptC3Experiences(db, cycle.conversationId, {
        cycleId: cycle.cycleId,
        generation: cycle.generation,
      });

      expect(result.queryStatus).toBe("success");
      expect(coverage(result)).toMatchObject({
        disposition: "INCLUDED",
        eligible_record_count: 1,
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        experienceId: record.experienceId,
        cycleId: record.cycleId,
        generation: record.generation,
        terminalPhase: "retry",
        failureClass: "attempts_exhausted",
        sourceDomainOwner: "retry",
        sourceCurrentnessRef: "cycle-current:generation:2",
        externalEffectTruth: "no_effect_proven",
        receiptRef: "durable_work_attempt:attempt-1",
        rawEvidenceRefsJson: record.rawEvidenceRefsJson,
      });
      expect(JSON.stringify(result.candidates[0])).not.toContain("provider.call");
      expect(JSON.stringify(result.candidates[0])).not.toContain("stack");
    } finally {
      db.close();
    }
  });

  it("keeps age alone from making resolved history current and excludes redacted or non-terminal rows", () => {
    const db = openTestSidecar();
    try {
      const current = admitTestCycle(db, {
        cycleId: "cycle-current",
        conversationId: "conversation-c3",
        triggerKind: "owner_message",
        triggerRef: "owner-current",
        generation: 2,
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-old",
        conversationId: "conversation-c3",
        triggerKind: "owner_message",
        triggerRef: "owner-old",
        generation: 1,
        nowMs: 2,
      });
      insertRecord(db, { experienceId: "c3:test:current" });
      insertRecord(db, { experienceId: "c3:test:redacted", redacted: 1 });
      insertRecord(db, {
        experienceId: "c3:test:old",
        cycleId: "cycle-old",
        generation: 1,
        unresolvedState: 0,
        sourceCurrentnessRef: "cycle-old:generation:1",
        occurredAtMs: 1,
      });
      insertRecord(db, {
        experienceId: "c3:test:unknown",
        failureClass: "outcome_unknown",
        terminalDisposition: "terminal",
      });

      const result = adaptC3Experiences(db, current.conversationId, {
        cycleId: current.cycleId,
        generation: current.generation,
      });

      expect(result.candidates.map((candidate) => candidate.experienceId)).toEqual(["c3:test:current"]);
      expect(coverage(result)).toMatchObject({ disposition: "INCLUDED" });
    } finally {
      db.close();
    }
  });

  it("reports resolved history as stale when no source-owned currentness binds it", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-current",
        conversationId: "conversation-stale",
        triggerKind: "owner_message",
        triggerRef: "owner-stale",
        generation: 2,
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-old",
        conversationId: "conversation-stale",
        triggerKind: "owner_message",
        triggerRef: "owner-stale-old",
        generation: 1,
        nowMs: 2,
      });
      insertRecord(db, {
        experienceId: "c3:test:stale",
        cycleId: "cycle-old",
        generation: 1,
        unresolvedState: 0,
        sourceCurrentnessRef: "cycle-old:generation:1",
      });
      const result = adaptC3Experiences(db, cycle.conversationId, {
        cycleId: cycle.cycleId,
        generation: cycle.generation,
      });
      expect(result.candidates).toEqual([]);
      expect(coverage(result)).toMatchObject({ disposition: "STALE", stale_record_count: 1 });
    } finally {
      db.close();
    }
  });

  it("reports C3 query failure as UNREACHABLE rather than EMPTY", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE c3_terminal_experiences");
      const result = adaptC3Experiences(db, "conversation-c3", { cycleId: "cycle-current", generation: 2 });
      expect(result.queryStatus).toBe("failed");
      expect(result.candidates).toEqual([]);
      expect(coverage(result)).toMatchObject({ disposition: "UNREACHABLE" });
    } finally {
      db.close();
    }
  });

  it("is called by buildThoughtInput through the normal C2 reconstruction path", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-input-c3",
        conversationId: "conversation-input-c3",
        triggerKind: "owner_message",
        triggerRef: "owner-input-c3",
        generation: 1,
        nowMs: 1,
      });
      appendOwnerUtterance(db, {
        conversationId: cycle.conversationId,
        text: "Continue the interrupted work.",
        discordMessageIds: ["discord-c3"],
        nowMs: 2,
      });
      insertRecord(db, {
        experienceId: "c3:test:input",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        unresolvedState: 1,
      });

      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        constitution: identity,
        capabilityReality: capability,
        workingContext: [],
        occupancy: [],
        learnedSelfSlice: { dispositions: [], interests: [] },
      });

      expect(input.c3Experiences.candidates).toHaveLength(1);
      expect(input.c3Experiences.candidates[0]?.sourceDomainOwner).toBe("retry");
      expect(coverage(input.c3Experiences)).toMatchObject({ disposition: "INCLUDED" });
    } finally {
      db.close();
    }
  });
});

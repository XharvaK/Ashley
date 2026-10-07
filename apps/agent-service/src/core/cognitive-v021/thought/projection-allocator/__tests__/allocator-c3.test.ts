import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../../../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../../../test-support.js";
import { buildThoughtInput } from "../../input.js";
import type { C3TerminalExperienceRecord } from "../../../failure/types.js";
import { allocateThoughtProjection } from "../allocator.js";

// Fixture calibration: Growth V1 memory-formation guidance adds ~900 tokens to
// the code-owned contract, so caller envelopes below carry a 1_000-token allowance.
// The afterglow guidance adds ~150 more; the envelopes that overflowed carry +500.
// G3 inner-life guidance adds ~700 more: the tight envelopes shift by +1_000.
// G4 growth guidance and schema (mood, expectations, revisions) add ~1_300 more: +1_000, like G3.
// G5 night guidance and schema add ~900 more: the same tight envelopes shift +1_000 again.

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
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function insertC3(db: ReturnType<typeof openTestSidecar>, cycleId: string, conversationId: string): void {
  const record: C3TerminalExperienceRecord = {
    experienceId: "c3:allocator:current",
    obligationFrontierId: null,
    cycleId,
    generation: 1,
    attemptId: "attempt-allocator",
    attemptLineageJson: JSON.stringify({ dispatchTruth: "not_started", errorCode: "provider_unavailable" }),
    terminalPhase: "retry",
    failureClass: "unavailable",
    terminalDisposition: "terminal",
    publicationState: "unpublished",
    externalEffectTruth: "no_effect_proven",
    receiptRef: "durable_work_attempt:attempt-allocator",
    unresolvedState: 1,
    rawEvidenceRefsJson: JSON.stringify([
      { kind: "inbox_events", id: "event-allocator" },
      { kind: "durable_work_attempts", id: "attempt-allocator" },
    ]),
    noticeId: null,
    occurredAtMs: 10,
    sourceDomainOwner: "retry",
    sourceCurrentnessRef: `${cycleId}:generation:1`,
    redacted: 0,
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
  void conversationId;
}

function makeInput(db: ReturnType<typeof openTestSidecar>, includeC3: boolean) {
  const cycle = admitTestCycle(db, {
    cycleId: includeC3 ? "cycle-allocator-c3" : "cycle-allocator-unreachable",
    conversationId: includeC3 ? "conversation-allocator-c3" : "conversation-allocator-unreachable",
    triggerKind: "owner_message",
    triggerRef: "owner-allocator-c3",
    nowMs: 1,
  });
  appendOwnerUtterance(db, {
    conversationId: cycle.conversationId,
    text: "Continue the interrupted work.",
    discordMessageIds: [`discord-${cycle.cycleId}`],
    nowMs: 2,
  });
  if (includeC3) insertC3(db, cycle.cycleId, cycle.conversationId);
  return buildThoughtInput({
    sidecar: db,
    cycle,
    constitution: identity,
    capabilityReality: capability,
    workingContext: [],
    occupancy: [],
    learnedSelfSlice: { dispositions: [], interests: [] },
    staticOperatingContract: "test-owned compact operating contract",
  });
}

describe("MAT-II C3 allocator integration", () => {
  it("uses the existing allocator and exposes a compact C3 section with receipt coverage", () => {
    const db = openTestSidecar();
    try {
      const input = makeInput(db, true);
      const allocated = allocateThoughtProjection({
        thoughtInput: input,
        requestId: "request-allocator-c3",
        semanticBudgetTokens: 15_300,
      });
      const projected = allocated.projected as typeof allocated.projected & {
        c3Experiences?: { version: 1; candidates: readonly unknown[] };
      };

      expect(projected.c3Experiences?.candidates).toHaveLength(1);
      expect(allocated.receipt.decision.included.map((item) => item.section)).toContain("c3_terminal_experiences");
      expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "failures_interruptions", disposition: "INCLUDED" }),
      ]));
      expect(JSON.parse(allocated.messages[1]?.content as string).c3Experiences.candidates).toHaveLength(1);
      expect(allocated.messages[0]?.content).toContain("You are Ashley's Thought layer.");
    } finally {
      db.close();
    }
  });

  it("keeps an unreachable C3 source fail-soft and visible in receipt coverage", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE c3_terminal_experiences");
      const input = makeInput(db, false);
      const allocated = allocateThoughtProjection({
        thoughtInput: input,
        requestId: "request-allocator-c3-unreachable",
        semanticBudgetTokens: 15_100,
      });

      expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "failures_interruptions", disposition: "UNREACHABLE" }),
      ]));
      expect(allocated.receipt.decision.included.map((item) => item.section)).not.toContain("c3_terminal_experiences");
    } finally {
      db.close();
    }
  });
});

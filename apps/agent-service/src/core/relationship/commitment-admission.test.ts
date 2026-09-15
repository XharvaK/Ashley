import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { readAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";
import { resolveActiveThread } from "../memory/threads.js";
import { fidelityCheck } from "../cognitive-v021/speech/fidelity.js";
import {
  claimCommitmentOpportunity,
  commitmentBindingsForSettlement,
  persistCommitmentProposals,
  recoverPendingCommitmentProposals,
  recoverCommitmentOpportunities,
  recheckCommitmentOpportunity,
  settlePersistedCommitmentProposals,
  COMMITMENT_PROVISIONAL_ORPHAN,
  type CommitmentProposal,
} from "./commitment-admission.js";
import { grantPerson, revokePerson } from "./social-authority.js";

const ownerId = "owner-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function dbFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function proposal(overrides: Partial<CommitmentProposal> = {}): CommitmentProposal {
  return {
    ordinal: 0,
    action: "send the Owner a progress update",
    beneficiary: "owner",
    destination: { kind: "owner_private" },
    temporal: { kind: "exact", atMs: nowMs + 60_000 },
    realizationClause: "I will send the Owner a progress update tomorrow.",
    thoughtCycle: { cycleId: "cycle-1", attemptId: "attempt-1" },
    ...overrides,
  };
}

function revision(db: DatabaseSync): number {
  return readAuthorityBarrier(db).revision;
}

describe("commitment admission and fidelity", () => {
  it("persists Host-owned ids, admits once, and leaves M1R unchanged", () => {
    const db = dbFixture();
    try {
      const before = revision(db);
      const input = proposal();
      const first = persistCommitmentProposals(db, "settlement-1", [input]);
      const retry = persistCommitmentProposals(db, "settlement-1", [input]);
      expect(first).toEqual(retry);
      expect(first[0]?.proposalId).toBe("cmt:settlement-1:0");
      expect(db.prepare("SELECT COUNT(*) AS count FROM commitment_settlements").get()).toEqual({ count: 1 });

      const settled = settlePersistedCommitmentProposals(db, "settlement-1", { ownerId, nowMs, enabled: true });
      expect(settled).toMatchObject([{ settled: true, admitted: true, commitmentId: "cmt:settlement-1:0", idempotentReplay: false }]);
      expect(revision(db)).toBe(before);
      expect(db.prepare("SELECT commitment_state, status FROM ashley_self_commitments").get())
        .toMatchObject({ commitment_state: "admitted", status: "motivated" });

      const replay = settlePersistedCommitmentProposals(db, "settlement-1", { ownerId, nowMs: nowMs + 1, enabled: true });
      expect(replay).toMatchObject([{ settled: true, admitted: true, idempotentReplay: true }]);
      expect(revision(db)).toBe(before);
      expect(commitmentBindingsForSettlement(db, "settlement-1")).toMatchObject([{
        commitmentId: "cmt:settlement-1:0",
        admissionRevision: before,
      }]);
    } finally {
      db.close();
    }
  });

  it("rejects an impossible destination before any opportunity row exists", () => {
    const db = dbFixture();
    try {
      persistCommitmentProposals(db, "impossible", [proposal({
        beneficiary: "person-1",
        destination: { kind: "dm", principalId: "person-1" },
      })]);
      const result = settlePersistedCommitmentProposals(db, "impossible", { ownerId, nowMs, enabled: true });
      expect(result).toMatchObject([{ settled: true, admitted: false, reason: "contact_not_eligible" }]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM ashley_self_commitments").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("admits an Owner-DM commitment only when its active thread belongs to the Owner", () => {
    const db = dbFixture();
    try {
      const threadId = resolveActiveThread(db, ownerId, "discord");
      persistCommitmentProposals(db, "owner-dm", [proposal({
        destination: { kind: "owner_dm", threadId },
      })]);
      expect(settlePersistedCommitmentProposals(db, "owner-dm", {
        ownerId,
        nowMs,
        enabled: true,
      })).toMatchObject([{ settled: true, admitted: true }]);

      const otherThreadId = resolveActiveThread(db, "owner-2", "discord");
      persistCommitmentProposals(db, "wrong-owner-dm", [proposal({
        destination: { kind: "owner_dm", threadId: otherThreadId },
      })]);
      expect(settlePersistedCommitmentProposals(db, "wrong-owner-dm", {
        ownerId,
        nowMs,
        enabled: true,
      })).toMatchObject([{ settled: true, admitted: false, reason: "owner_dm_not_authorized" }]);
    } finally {
      db.close();
    }
  });

  it("rejects model-emitted ids and fails closed when activation is off", () => {
    const db = dbFixture();
    try {
      expect(() => persistCommitmentProposals(db, "bad-shape", [{ ...proposal(), uuid: "model-id" } as unknown as CommitmentProposal]))
        .toThrow("commitment_proposal_shape_invalid");
      persistCommitmentProposals(db, "disabled", [proposal()]);
      expect(settlePersistedCommitmentProposals(db, "disabled", { ownerId, nowMs }))
        .toMatchObject([{ settled: true, admitted: false, reason: "commitments_disabled" }]);
    } finally {
      db.close();
    }
  });

  it("holds certainty and deadline shifts when Expression drops the exact realization clause", () => {
    const commitments = {
      commitmentProposals: [proposal()],
    };
    expect(fidelityCheck({
      mode: "draft",
      draft: "I will send the Owner a progress update tomorrow.",
      commitments,
      commitmentBindings: [{ commitmentId: "cmt:test:0", realizationClauseHash: "hash", admissionRevision: 0 }],
      commitmentRealizationClauses: [proposal().realizationClause],
    })).toMatchObject({ ok: true });
    expect(fidelityCheck({
      mode: "draft",
      draft: "I will definitely send the Owner a progress update today.",
      commitments,
      commitmentBindings: [{ commitmentId: "cmt:test:0", realizationClauseHash: "hash", admissionRevision: 0 }],
      commitmentRealizationClauses: [proposal().realizationClause],
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
    expect(fidelityCheck({
      mode: "draft",
      draft: "I may send the Owner a progress update tomorrow.",
      commitments,
      commitmentBindings: [{ commitmentId: "cmt:test:0", realizationClauseHash: "hash", admissionRevision: 0 }],
      commitmentRealizationClauses: [proposal().realizationClause],
    })).toMatchObject({ ok: false, code: "DRAFT_COMMITMENT_CONFLICT" });
  });

  it("defers a blocked wake without creating a retry storm", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-2",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      persistCommitmentProposals(db, "blocked", [proposal({
        beneficiary: "person-2",
        destination: { kind: "dm", principalId: "person-2" },
        temporal: { kind: "open" },
      })]);
      settlePersistedCommitmentProposals(db, "blocked", { ownerId, nowMs, enabled: true });
      const claimed = claimCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:blocked:0", nowMs });
      expect(claimed).not.toBeNull();
      revokePerson(db, { entityUuid: permit.entityUuid, nowMs: nowMs + 1 });
      const deferred = recheckCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:blocked:0", nowMs: nowMs + 2, blockedBackoffMs: 30_000 });
      expect(deferred).toMatchObject({ kind: "defer", reason: "contact_not_eligible", nextFireAtMs: nowMs + 30_002 });
      const second = recheckCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:blocked:0", nowMs: nowMs + 3, blockedBackoffMs: 30_000 });
      expect(second).toMatchObject({ kind: "defer" });
      expect(db.prepare("SELECT commitment_state, fire_at_ms FROM ashley_self_commitments WHERE entity_uuid = 'cmt:blocked:0'").get())
        .toMatchObject({ commitment_state: "deferred_blocked", fire_at_ms: nowMs + 30_003 });
    } finally {
      db.close();
    }
  });

  it("marks overdue opportunities missed and prevents double fire after a claim", () => {
    const db = dbFixture();
    try {
      persistCommitmentProposals(db, "overdue", [proposal({ temporal: { kind: "exact", atMs: nowMs + 1 } })]);
      settlePersistedCommitmentProposals(db, "overdue", { ownerId, nowMs, enabled: true });
      expect(recoverCommitmentOpportunities(db, { ownerId, nowMs: nowMs + 10_000, overdueGraceMs: 0 })).toMatchObject({ missed: 1 });

      persistCommitmentProposals(db, "claim", [proposal({ temporal: { kind: "open" } })]);
      settlePersistedCommitmentProposals(db, "claim", { ownerId, nowMs, enabled: true });
      expect(claimCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:claim:0", nowMs })).not.toBeNull();
      expect(claimCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:claim:0", nowMs: nowMs + 1 })).toBeNull();
      expect(recoverCommitmentOpportunities(db, { ownerId, nowMs: nowMs + 5 * 60_000 + 1 })).toMatchObject({ requeued: 1 });
      db.prepare("UPDATE relationship_motivation_claims SET lease_until = '1970-01-01T00:00:00.000Z' WHERE relationship_entity_uuid = 'cmt:claim:0'").run();
      expect(claimCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:claim:0", nowMs: nowMs + 5 * 60_000 + 2 })).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("reconciles a pending settlement to an explicit provisional orphan without admitting a promise", () => {
    const db = dbFixture();
    try {
      persistCommitmentProposals(db, "pending-orphan", [proposal({ temporal: { kind: "open" } })]);
      const recovered = recoverPendingCommitmentProposals(db, { ownerId, nowMs, enabled: true });

      expect(recovered).toMatchObject([{
        settled: false,
        proposalId: "cmt:pending-orphan:0",
        reason: COMMITMENT_PROVISIONAL_ORPHAN,
      }]);
      const settlement = db.prepare("SELECT result_json, settled_at_ms FROM commitment_settlements WHERE proposal_id = ?")
        .get("cmt:pending-orphan:0") as { result_json?: unknown; settled_at_ms?: unknown };
      expect(String(settlement.result_json)).toContain(COMMITMENT_PROVISIONAL_ORPHAN);
      expect(settlement.settled_at_ms).not.toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS count FROM ashley_self_commitments").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("marks a crashed attempted fire as a provisional orphan before requeueing it", () => {
    const db = dbFixture();
    try {
      persistCommitmentProposals(db, "attempted-orphan", [proposal({ temporal: { kind: "open" } })]);
      settlePersistedCommitmentProposals(db, "attempted-orphan", { ownerId, nowMs, enabled: true });
      expect(claimCommitmentOpportunity(db, { ownerId, commitmentId: "cmt:attempted-orphan:0", nowMs })).not.toBeNull();

      const recovered = recoverCommitmentOpportunities(db, {
        ownerId,
        nowMs: nowMs + 5 * 60_000 + 1,
      });
      expect(recovered).toMatchObject({ requeued: 1 });
      const row = db.prepare("SELECT commitment_state, evidence_json FROM ashley_self_commitments WHERE entity_uuid = ?")
        .get("cmt:attempted-orphan:0") as { commitment_state?: unknown; evidence_json?: unknown };
      expect(row.commitment_state).toBe("admitted");
      expect(JSON.parse(String(row.evidence_json))).toMatchObject({ recoveryStatus: COMMITMENT_PROVISIONAL_ORPHAN });
    } finally {
      db.close();
    }
  });
});

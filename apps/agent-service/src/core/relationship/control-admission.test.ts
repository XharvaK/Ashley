import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { readAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";
import { appendControlSettlementReceipt, getInboxEvent } from "../cognitive-v021/cycle/inbox.js";
import {
  CONTROL_INTERPRETATION_SCHEMA,
  parseControlInterpretation,
  persistControlProposals,
  recoverControlSettlement,
  replayPendingControlProposals,
  settlePersistedControlProposals,
  validateControlInterpretation,
  type ControlProposal,
} from "./control-admission.js";
import { resolvePrincipalRef } from "./principal-resolve.js";

const ownerId = "owner-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function dbFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function proposal(overrides: Partial<ControlProposal> = {}): ControlProposal {
  return {
    ordinal: 0,
    op: "grant_person",
    principalRef: { kind: "mention", userId: "person-1", messageId: "owner-message-1" },
    scope: "person_wide",
    duration: { kind: "until_revoked" },
    sourceSpan: { messageId: "owner-message-1", start: 0, end: 24, polarity: "affirmative" },
    thoughtCycle: { cycleId: "cycle-1", attemptId: "attempt-1" },
    ...overrides,
  };
}

function revision(db: DatabaseSync): number {
  return readAuthorityBarrier(db).revision;
}

describe("bounded Owner control interpretation and admission", () => {
  it("accepts only the dedicated phase result and rejects ordinary Thought fields or Host ids", () => {
    expect(validateControlInterpretation({ kind: "none" })).toEqual({ kind: "none" });
    expect(validateControlInterpretation({ kind: "ambiguous", reason: "quoted text" })).toEqual({
      kind: "ambiguous",
      reason: "quoted text",
    });
    expect(parseControlInterpretation(JSON.stringify({ kind: "proposals", proposals: [proposal()] }))).toMatchObject({
      kind: "proposals",
    });
    expect(() => validateControlInterpretation({ kind: "proposals", proposals: [{ ...proposal(), proposalId: "model-id" }] }))
      .toThrow("control_phase_violation");
    expect(() => validateControlInterpretation({ kind: "proposals", proposals: [{ ...proposal(), speech: "say this" }] }))
      .toThrow("control_phase_violation");
    expect(() => validateControlInterpretation({ kind: "proposals", proposals: [{ ...proposal(), op: "request_more_freedom" }] }))
      .toThrow("control_phase_violation");
    expect(CONTROL_INTERPRETATION_SCHEMA).not.toHaveProperty("properties.controlProposals");
  });

  it("resolves mention, reply, and exact bare-name candidates by the frozen precedence", () => {
    expect(resolvePrincipalRef(
      { kind: "mention", userId: "person-1", messageId: "m1" },
    )).toMatchObject({ ok: true, principalId: "person-1", source: "mention" });
    expect(resolvePrincipalRef(
      { kind: "reply_to", messageId: "m2" },
      { replyAuthors: { m2: "person-2" } },
    )).toMatchObject({ ok: true, principalId: "person-2", source: "reply_to" });
    expect(resolvePrincipalRef(
      { kind: "name", value: "Lyra", messageId: "m3" },
      {
        roomMembers: [{ exactName: "Lyra", principalId: "person-room" }],
        permits: [{ exactName: "Lyra", principalId: "person-permit" }],
      },
    )).toMatchObject({ ok: true, principalId: "person-room", source: "room_member" });
    expect(resolvePrincipalRef(
      { kind: "name", value: "Lyra", messageId: "m3" },
      { roomMembers: [{ exactName: "Lyra", principalId: "a" }, { exactName: "Lyra", principalId: "b" }] },
    )).toEqual({ ok: false, reason: "ambiguous_principal" });
    expect(resolvePrincipalRef({ kind: "name", value: "Lyra", messageId: "m3" })).toEqual({
      ok: false,
      reason: "ambiguous_principal",
    });
  });

  it("persists Host-owned ids in TX-B1 and settles an effective grant exactly once", () => {
    const db = dbFixture();
    try {
      const before = revision(db);
      const input = proposal();
      const first = persistControlProposals(db, "evidence-1", [input], { kind: "owner", ownerId, nowMs });
      const second = persistControlProposals(db, "evidence-1", [input], { kind: "owner", ownerId, nowMs: nowMs + 1 });
      expect(first).toEqual(second);
      expect(first.proposals[0].proposalId).toBe("ctrl:evidence-1:0");
      expect(db.prepare("SELECT COUNT(*) AS count FROM control_settlements").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT result_json, settled_at_ms FROM control_settlements").get()).toEqual({
        result_json: null,
        settled_at_ms: null,
      });

      const settled = settlePersistedControlProposals(db, "evidence-1", { nowMs });
      expect(settled).toMatchObject([{ settled: true, proposalId: "ctrl:evidence-1:0", idempotentReplay: false }]);
      expect(revision(db)).toBe(before + 1);
      const replay = replayPendingControlProposals(db, "evidence-1", { nowMs: nowMs + 1 });
      expect(replay).toMatchObject([{ settled: true, proposalId: "ctrl:evidence-1:0", idempotentReplay: true }]);
      expect(revision(db)).toBe(before + 1);
      expect(recoverControlSettlement(db, "ctrl:evidence-1:0")).toMatchObject({ settled: true, appliedRevision: before + 1 });
      expect(db.prepare("SELECT result_json IS NOT NULL AS settled, settled_at_ms IS NOT NULL AS stamped FROM control_settlements").get())
        .toEqual({ settled: 1, stamped: 1 });
    } finally {
      db.close();
    }
  });

  it("keeps ambiguous, quoted, and no-op proposals mutation-free", () => {
    const db = dbFixture();
    try {
      const before = revision(db);
      persistControlProposals(db, "ambiguous-source", [proposal({
        principalRef: { kind: "name", value: "Lyra", messageId: "owner-message-2" },
      })], { kind: "owner", ownerId, nowMs, resolutionContext: {
        roomMembers: [{ exactName: "Lyra", principalId: "a" }, { exactName: "Lyra", principalId: "b" }],
      } });
      const ambiguous = settlePersistedControlProposals(db, "ambiguous-source", { nowMs, resolutionContext: {
        roomMembers: [{ exactName: "Lyra", principalId: "a" }, { exactName: "Lyra", principalId: "b" }],
      } });
      expect(ambiguous).toMatchObject([{ settled: false, reason: "ambiguous_principal" }]);
      expect(revision(db)).toBe(before);

      const first = persistControlProposals(db, "noop-source", [proposal({
        principalRef: { kind: "mention", userId: "person-noop", messageId: "owner-message-3" },
      })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "noop-source", { nowMs });
      const afterGrant = revision(db);
      persistControlProposals(db, "noop-source-2", [proposal({
        principalRef: { kind: "mention", userId: "person-noop", messageId: "owner-message-4" },
      })], { kind: "owner", ownerId, nowMs });
      const noOp = settlePersistedControlProposals(db, "noop-source-2", { nowMs });
      expect(noOp).toMatchObject([{ settled: true, idempotentReplay: false, appliedRevision: afterGrant }]);
      expect(revision(db)).toBe(afterGrant);
      expect(first.proposals[0].proposalId).toBe("ctrl:noop-source:0");
    } finally {
      db.close();
    }
  });

  it("applies revoke, prohibition, narrowing, room controls, and read-evaluated expiry without double advance", () => {
    const db = dbFixture();
    try {
      persistControlProposals(db, "grant", [proposal({ ordinal: 0, principalRef: { kind: "mention", userId: "person-x", messageId: "m" } })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "grant", { nowMs });
      const afterGrant = revision(db);

      persistControlProposals(db, "narrow", [proposal({ ordinal: 0, op: "narrow_person", principalRef: { kind: "mention", userId: "person-x", messageId: "m2" }, scope: "dm_only" })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "narrow", { nowMs });
      expect(revision(db)).toBe(afterGrant + 1);
      const beforeRevoke = revision(db);
      persistControlProposals(db, "revoke", [proposal({ ordinal: 0, op: "revoke_person", principalRef: { kind: "mention", userId: "person-x", messageId: "m3" }, scope: "dm_only" })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "revoke", { nowMs });
      expect(revision(db)).toBe(beforeRevoke + 1);
      settlePersistedControlProposals(db, "revoke", { nowMs });
      expect(revision(db)).toBe(beforeRevoke + 1);

      const beforeProhibit = revision(db);
      persistControlProposals(db, "prohibit", [proposal({ ordinal: 0, op: "prohibit_person", principalRef: { kind: "mention", userId: "person-y", messageId: "m4" }, scope: "person_wide" })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "prohibit", { nowMs });
      expect(revision(db)).toBe(beforeProhibit + 1);

      const room = { roomLocal: "guild-1:channel-1" } as const;
      persistControlProposals(db, "room", [proposal({ ordinal: 0, op: "grant_room", principalRef: { kind: "mention", userId: "unused", messageId: "m5" }, scope: room })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "room", { nowMs });
      expect(db.prepare("SELECT mode, provenance FROM trusted_rooms WHERE guild_id = 'guild-1' AND channel_id = 'channel-1'").get()).toEqual({ mode: "trusted_social", provenance: "owner_grant_nl" });
      const roomRevision = revision(db);
      persistControlProposals(db, "room-narrow", [proposal({ ordinal: 0, op: "narrow_room", principalRef: { kind: "mention", userId: "unused", messageId: "m6" }, scope: room })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "room-narrow", { nowMs });
      expect(revision(db)).toBe(roomRevision + 1);

      persistControlProposals(db, "expiry", [proposal({ ordinal: 0, principalRef: { kind: "mention", userId: "person-expiring", messageId: "m7" }, duration: { kind: "until", atMs: nowMs + 60_000 } })], { kind: "owner", ownerId, nowMs });
      settlePersistedControlProposals(db, "expiry", { nowMs });
      expect(db.prepare("SELECT expires_at FROM social_permits WHERE principal_id = 'person-expiring'").get()).toEqual({ expires_at: new Date(nowMs + 60_000).toISOString() });
    } finally {
      db.close();
    }
  });

  it("feeds actual settlement results through a dedicated inbox receipt", () => {
    const db = openTestSidecar();
    try {
      const receipt = appendControlSettlementReceipt(db, {
        conversationId: "owner-thread",
        sourceRef: "evidence-receipt",
        proposalId: "ctrl:evidence-receipt:0",
        settlements: [{ settled: false, proposalId: "ctrl:evidence-receipt:0", reason: "ambiguous_principal" }],
        ownerId,
        nowMs,
      });
      expect(receipt.kind).toBe("control_settlement_receipt");
      expect(getInboxEvent(db, receipt.id)?.payload).toMatchObject({ sourceRef: "evidence-receipt" });
    } finally {
      db.close();
    }
  });
});

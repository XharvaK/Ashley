import { describe, expect, it } from "vitest";
import {
  applyPublicPresenceDecision,
  MAX_PUBLIC_PRESENCE_CHARS,
  PUBLIC_PRESENCE_OPERATION,
  PUBLIC_PRESENCE_TTL_MS,
  isAutonomousPublicPresenceProposal,
  isAutonomousPublicPresenceOpportunity,
  readPublicPresenceContext,
  readPublicPresenceState,
  recordPublicPresenceProjection,
  validatePublicPresenceRequest,
  withPublicPresenceCapability,
} from "./public-presence.js";
import { admitTestCycle, openTestSidecar } from "./test-support.js";

describe("autonomous public presence", () => {
  it("accepts exact SET and CLEAR decisions and exposes the bounded operation", () => {
    expect(PUBLIC_PRESENCE_OPERATION).toBe("discord.public_presence");
    expect(validatePublicPresenceRequest({ action: "set", text: "A small public note." })).toEqual({
      ok: true,
      decision: { action: "set", text: "A small public note." },
    });
    expect(validatePublicPresenceRequest({ action: "clear" })).toEqual({
      ok: true,
      decision: { action: "clear" },
    });
  });

  it("rejects overlong text without truncating or rewriting it", () => {
    const text = "x".repeat(MAX_PUBLIC_PRESENCE_CHARS + 1);
    expect(validatePublicPresenceRequest({ action: "set", text })).toEqual({
      ok: false,
      code: "too_long",
    });
  });

  it("rejects empty, whitespace-only, control, and credential-shaped text", () => {
    expect(validatePublicPresenceRequest({ action: "set", text: "" })).toEqual({
      ok: false,
      code: "empty",
    });
    expect(validatePublicPresenceRequest({ action: "set", text: "   " })).toEqual({
      ok: false,
      code: "whitespace_only",
    });
    expect(validatePublicPresenceRequest({ action: "set", text: "visible\ntext" })).toEqual({
      ok: false,
      code: "control_character",
    });
    expect(validatePublicPresenceRequest({ action: "set", text: "OPENAI_API_KEY=sk-test-value" })).toEqual({
      ok: false,
      code: "credential_shape",
    });
  });

  it("reuses deterministic privacy admission for protected material without rewriting ordinary text", () => {
    expect(validatePublicPresenceRequest(
      { action: "set", text: "A private project detail." },
      { protectedCategories: ["doc_projects"] },
    )).toEqual({ ok: false, code: "protected_category" });
    expect(validatePublicPresenceRequest(
      { action: "set", text: "An unresolved note." },
      { classification: null },
    )).toEqual({ ok: false, code: "unknown_classification" });
    expect(validatePublicPresenceRequest(
      { action: "set", text: "An ordinary public sentence." },
      { classification: "ordinary", thoughtAuthorized: true },
    )).toEqual({ ok: true, decision: { action: "set", text: "An ordinary public sentence." } });
  });

  it("allows ordinary self-presentation without a Host semantic taxonomy", () => {
    expect(validatePublicPresenceRequest({ action: "set", text: "There is room for one more question." })).toEqual({
      ok: true,
      decision: { action: "set", text: "There is room for one more question." },
    });
  });

  it("exposes the capability only for a fully public idle opportunity", () => {
    expect(
      isAutonomousPublicPresenceOpportunity({
        cycleTriggerKind: "idle_opportunity",
        wakeSourceKind: "idle",
        eventKind: "idle_opportunity",
        channel: "discord",
        occupantId: "owner",
        configuredOwnerId: "owner",
        reconciling: false,
      }),
    ).toBe(true);

    expect(
      isAutonomousPublicPresenceOpportunity({
        cycleTriggerKind: "owner_message",
        wakeSourceKind: "owner",
        eventKind: "owner_utterance",
        channel: "discord",
        occupantId: "owner",
        configuredOwnerId: "owner",
        reconciling: false,
      }),
    ).toBe(false);
  });

  it("removes the public capability from interactive reality", () => {
    const base = {
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
    expect(withPublicPresenceCapability(base, false)).not.toHaveProperty("publicPresence");
    expect(withPublicPresenceCapability(base, true).publicPresence).toMatchObject({
      operationKind: PUBLIC_PRESENCE_OPERATION,
      semanticClass: "effect",
      audience: "FULLY_PUBLIC",
    });
  });

  it("persists exact SET text for 12 hours and leaves it unchanged for NONE", () => {
    const db = openTestSidecar();
    try {
      const authoredAtMs = 1_000_000;
      const state = applyPublicPresenceDecision({
        db,
        decision: { action: "set", text: "Exact public wording." },
        cycleId: "cycle-presence-set",
        generation: 3,
        effectId: "effect-presence-set",
        authoredAtMs,
      });
      expect(state).toMatchObject({
        action: "set",
        text: "Exact public wording.",
        authoredAtMs,
        expiresAtMs: authoredAtMs + PUBLIC_PRESENCE_TTL_MS,
        sourceCycleId: "cycle-presence-set",
        sourceGeneration: 3,
        sourceEffectId: "effect-presence-set",
        stateRevision: 1,
        projectionState: "pending",
      });
      const before = readPublicPresenceState(db);
      expect(readPublicPresenceContext(db, authoredAtMs + 60 * 60 * 1000).text).toBe("Exact public wording.");
      expect(readPublicPresenceState(db)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("preserves the prior desired state when SET admission rejects text", () => {
    const db = openTestSidecar();
    try {
      applyPublicPresenceDecision({
        db,
        decision: { action: "set", text: "The prior exact state." },
        cycleId: "cycle-presence-prior",
        generation: 1,
        effectId: "effect-presence-prior",
        authoredAtMs: 2_000_000,
      });
      const prior = readPublicPresenceState(db);
      expect(validatePublicPresenceRequest({ action: "set", text: "x".repeat(129) })).toEqual({
        ok: false,
        code: "too_long",
      });
      expect(readPublicPresenceState(db)).toEqual(prior);
    } finally {
      db.close();
    }
  });

  it("supports durable CLEAR and logical expiry without a fallback line", () => {
    const db = openTestSidecar();
    try {
      applyPublicPresenceDecision({
        db,
        decision: { action: "set", text: "Will expire." },
        cycleId: "cycle-presence-expiry",
        generation: 1,
        effectId: "effect-presence-expiry",
        authoredAtMs: 3_000_000,
      });
      expect(readPublicPresenceContext(db, 3_000_000 + PUBLIC_PRESENCE_TTL_MS).text).toBeNull();
      const cleared = applyPublicPresenceDecision({
        db,
        decision: { action: "clear" },
        cycleId: "cycle-presence-clear",
        generation: 2,
        effectId: "effect-presence-clear",
        authoredAtMs: 4_000_000,
      });
      expect(cleared).toMatchObject({ action: "clear", text: null, expiresAtMs: null, stateRevision: 2 });
      expect(readPublicPresenceContext(db, 4_000_001)).toMatchObject({ text: null, audience: "FULLY_PUBLIC" });
    } finally {
      db.close();
    }
  });

  it("keeps desired state separate from a failed or stale projection receipt", () => {
    const db = openTestSidecar();
    try {
      const state = applyPublicPresenceDecision({
        db,
        decision: { action: "set", text: "Desired, not yet displayed." },
        cycleId: "cycle-presence-projection",
        generation: 1,
        effectId: "effect-presence-projection",
        authoredAtMs: 5_000_000,
      });
      expect(recordPublicPresenceProjection(db, {
        stateRevision: state.stateRevision,
        sourceEffectId: state.sourceEffectId,
        outcome: "failed",
        cause: "refresh",
        error: "discord unavailable",
        atMs: 5_000_001,
      })).toMatchObject({ accepted: true, state: { text: "Desired, not yet displayed.", projectionState: "failed" } });
      expect(recordPublicPresenceProjection(db, {
        stateRevision: state.stateRevision - 1,
        sourceEffectId: state.sourceEffectId,
        outcome: "succeeded",
        cause: "stale",
        atMs: 5_000_002,
      }).accepted).toBe(false);
    } finally {
      db.close();
    }
  });

  it("defends the executor gate against an interactive owner event", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-presence-interactive",
        conversationId: "conversation-presence",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-presence-interactive",
        occupantId: "owner",
        nowMs: 6_000_000,
      });
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ ownerId: "owner", channel: "discord" }),
        "event-presence-interactive",
      );
      expect(isAutonomousPublicPresenceProposal(db, {
        cycleId: cycle.cycleId,
        originEventId: "event-presence-interactive",
      }, "owner")).toBe(false);
    } finally {
      db.close();
    }
  });
});

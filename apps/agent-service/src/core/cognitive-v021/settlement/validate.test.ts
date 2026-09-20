import { describe, expect, it } from "vitest";
import { makeThoughtDraft } from "../test-support.js";
import { validateThoughtSettlementDraft } from "./validate.js";

const active = {
  cycleId: "cycle-1",
  generation: 1,
  occupantId: "doc",
  authorityEpoch: 1,
  consumedEffectIds: ["effect-1"],
};

describe("v0.2.1 ThoughtSettlementDraft validation", () => {
  it("rejects missing schemaVersion and draft speech without surfaceDraft", () => {
    const missing = { ...makeThoughtDraft(), schemaVersion: undefined };
    expect(validateThoughtSettlementDraft(missing, active)).toMatchObject({ ok: false, kind: "malformed" });

    const noSurface = makeThoughtDraft({ speech: { ...makeThoughtDraft().speech, surfaceDraft: null } });
    expect(validateThoughtSettlementDraft(noSurface, active)).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("rejects none mode with text, while allowing sparse draft commitments", () => {
    const noneWithText = makeThoughtDraft({
      speech: { ...makeThoughtDraft().speech, mode: "none", surfaceDraft: "should not speak" },
    });
    expect(validateThoughtSettlementDraft(noneWithText, active)).toMatchObject({ ok: false, kind: "malformed" });

    const emptyCommitments = makeThoughtDraft({
      commitments: { ...makeThoughtDraft().commitments, epistemic: [], conversational: [] },
    });
    expect(validateThoughtSettlementDraft(emptyCommitments, active)).toMatchObject({ ok: true });

    const unknownEffect = makeThoughtDraft({ operations: { ...makeThoughtDraft().operations, effectsCompleted: ["effect-unknown"] } });
    expect(validateThoughtSettlementDraft(unknownEffect, active)).toMatchObject({ ok: false, kind: "malformed" });

    const tooManyRevisions = makeThoughtDraft({ authority: { objectionsApplied: [], revisionCount: 3 } });
    expect(validateThoughtSettlementDraft(tooManyRevisions, active)).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("rejects conversational commitment literals outside the canonical set", () => {
    const invalid = makeThoughtDraft({
      commitments: {
        ...makeThoughtDraft().commitments,
        conversational: ["answering" as any],
      },
    });
    expect(validateThoughtSettlementDraft(invalid, active)).toMatchObject({
      ok: false,
      kind: "malformed",
      error: "CONVERSATIONAL_COMMITMENT_INVALID",
    });
  });

  it("accepts a private none settlement with an occupancy delta", () => {
    const draft = makeThoughtDraft({
      speech: { ...makeThoughtDraft().speech, mode: "none", surfaceDraft: null },
      commitments: { ...makeThoughtDraft().commitments, epistemic: [], conversational: [] },
      occupancyDelta: [{
        op: "set",
        occupancy: {
          conversationId: "thread-1",
          concernId: "concern-1",
          status: "active",
          priority: 2,
          updatedGeneration: 1,
        },
      }],
    });
    expect(validateThoughtSettlementDraft(draft, active)).toMatchObject({ ok: true, draft });
  });

  it("rejects published-only fields instead of accepting model-authored license state", () => {
    const published = { ...makeThoughtDraft(), finalLicensedText: "licensed" };
    expect(validateThoughtSettlementDraft(published, active)).toMatchObject({ ok: false, kind: "malformed" });
  });

  it("accepts initiativePreference only in valid optional-initiative context", () => {
    const preference = { stance: "strong" as const, reason: "The Owner asked for a check-in." };
    const context = { triggerKind: "idle_opportunity" as const };

    // Old absent payloads remain valid with or without context.
    expect(validateThoughtSettlementDraft(makeThoughtDraft(), active)).toMatchObject({ ok: true });
    expect(validateThoughtSettlementDraft(makeThoughtDraft(), { ...active, ...context })).toMatchObject({ ok: true });

    // Each valid trigger family member is accepted.
    for (const triggerKind of ["idle_opportunity", "subscription_item", "future_trigger_due"] as const) {
      expect(validateThoughtSettlementDraft(
        makeThoughtDraft({ initiativePreference: { ...preference } }),
        { ...active, triggerKind },
      )).toMatchObject({ ok: true });
    }
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { stance: "willing", reason: "Following up." } }),
      { ...active, ...context },
    )).toMatchObject({ ok: true });

    // Each excluded trigger is rejected.
    for (const triggerKind of ["owner_message", "external_message", "commitment_due", "observation_or_receipt", "recovery"] as const) {
      expect(validateThoughtSettlementDraft(
        makeThoughtDraft({ initiativePreference: { ...preference } }),
        { ...active, triggerKind },
      )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_CONTEXT_INVALID" });
    }

    // Obligation and repair context rejected even on a valid trigger.
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { ...preference } }),
      { ...active, ...context, dueCommitmentPresent: true },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_CONTEXT_INVALID" });
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { ...preference } }),
      { ...active, ...context, continuityRepairPresent: true },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_CONTEXT_INVALID" });

    // Unproven context fails closed.
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { ...preference } }),
      active,
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_CONTEXT_INVALID" });
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { ...preference } }),
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_CONTEXT_INVALID" });

    // Shape violations rejected even in valid context.
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { stance: "urgent" as never, reason: "Following up." } }),
      { ...active, ...context },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_INVALID" });
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { stance: "willing", reason: "" } }),
      { ...active, ...context },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_INVALID" });
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { stance: "willing", reason: "x".repeat(281) } }),
      { ...active, ...context },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_INVALID" });
    expect(validateThoughtSettlementDraft(
      makeThoughtDraft({ initiativePreference: { stance: "willing", reason: "Following up.", timingClass: "now" } as never }),
      { ...active, ...context },
    )).toMatchObject({ ok: false, kind: "malformed", error: "INITIATIVE_PREFERENCE_INVALID" });

    // No default preference is ever generated: absence stays absent.
    const accepted = validateThoughtSettlementDraft(makeThoughtDraft(), { ...active, ...context });
    expect(accepted).toMatchObject({ ok: true });
    if (accepted.ok) expect(accepted.draft.initiativePreference).toBeUndefined();
  });

  it("validates operational state claims and enforces allowlist", () => {
    const validDraft = makeThoughtDraft({
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef: "effect:valid", claimedState: "succeeded" }],
      },
    });
    // With allowlist containing effect:valid
    const activeWithAllowlist = { ...active, effectAllowlist: new Set(["effect:valid"]) };
    expect(validateThoughtSettlementDraft(validDraft, activeWithAllowlist)).toMatchObject({ ok: true });

    // An empty Host-owned namespace rejects every operational claim.
    expect(validateThoughtSettlementDraft(validDraft, { ...active, effectAllowlist: new Set<string>() })).toMatchObject({
      ok: false,
      kind: "conflict",
      error: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
    });

    // Unknown effectRef outside allowlist fails closed
    const unknownDraft = makeThoughtDraft({
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef: "effect:unknown", claimedState: "succeeded" }],
      },
    });
    expect(validateThoughtSettlementDraft(unknownDraft, activeWithAllowlist)).toMatchObject({
      ok: false,
      kind: "conflict",
      error: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
    });

    // All 5 claimedState literals valid
    for (const state of ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"] as const) {
      const stateDraft = makeThoughtDraft({
        commitments: {
          ...makeThoughtDraft().commitments,
          operational: [{ effectRef: "effect:valid", claimedState: state }],
        },
      });
      expect(validateThoughtSettlementDraft(stateDraft, activeWithAllowlist)).toMatchObject({ ok: true });
    }

    // Invalid claimedState rejected
    const invalidStateDraft = makeThoughtDraft({
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef: "effect:valid", claimedState: "worked" as any }],
      },
    });
    expect(validateThoughtSettlementDraft(invalidStateDraft, activeWithAllowlist)).toMatchObject({
      ok: false,
      kind: "malformed",
      error: "OPERATIONAL_CLAIMED_STATE_INVALID",
    });
  });
});

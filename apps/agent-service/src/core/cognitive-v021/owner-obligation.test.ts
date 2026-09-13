import { describe, expect, it } from "vitest";
import {
  ownerCoverageHash,
  resolveOwnerObligation,
  type OwnerDispatchCoverage,
} from "./owner-obligation.js";

function coverage(overrides: Partial<OwnerDispatchCoverage> = {}): OwnerDispatchCoverage {
  const base = {
    primaryEventId: "owner-1",
    coveredOwnerEventIds: ["owner-1"],
    uncoveredOwnerEventIds: [],
  } satisfies Omit<OwnerDispatchCoverage, "coverageHash">;
  const value = { ...base, ...overrides };
  return {
    ...value,
    coverageHash: ownerCoverageHash(value),
  };
}

describe("Owner-obligation result envelope", () => {
  it("transfers published draft speech to the actual delivery owner", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "published",
      speechMode: "draft",
      conversationalCommitments: ["answer"],
      settlementId: "settlement-1",
      outboxId: 7,
      deliveryOwnerExists: true,
      remainingConsequence: false,
    });

    expect(result).toMatchObject({
      attemptOutcome: "published",
      ownerObligationOutcome: "transferred",
      settlementId: "settlement-1",
      successorIdentity: "speech_outbox:7",
      deliveryDisposition: "handed_to_delivery",
      remainingResponsibility: "delivery_confirmation",
    });
  });

  it("does not claim a handoff when draft speech has no valid delivery owner", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "published",
      speechMode: "draft",
      conversationalCommitments: ["answer"],
      settlementId: "settlement-1",
      outboxId: null,
      deliveryOwnerExists: false,
      remainingConsequence: false,
    });

    expect(result.ownerObligationOutcome).toBe("unresolved");
    expect(result.deliveryDisposition).toBe("delivery_unknown");
  });

  it("resolves only explicit semantic silence with exact coverage", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "published",
      speechMode: "none",
      conversationalCommitments: ["silence"],
      settlementId: "settlement-2",
      outboxId: null,
      deliveryOwnerExists: false,
      remainingConsequence: false,
    });

    expect(result).toMatchObject({
      ownerObligationOutcome: "resolved",
      semanticCommitment: "silence",
      deliveryDisposition: "not_required",
      remainingResponsibility: null,
    });
  });

  it("keeps no-speech without semantic silence unresolved", () => {
    const result = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "published",
      speechMode: "none",
      conversationalCommitments: ["acknowledge"],
      settlementId: "settlement-3",
      outboxId: null,
      deliveryOwnerExists: false,
      remainingConsequence: false,
    });

    expect(result.ownerObligationOutcome).toBe("unresolved");
    expect(result.remainingResponsibility).toBe("owner_conversational_obligation");
  });

  it("preserves Owner abstention and allows opportunity-only no-action", () => {
    const owner = resolveOwnerObligation({
      eventId: "owner-1",
      eventKind: "owner_message",
      coverage: coverage(),
      attemptOutcome: "abstained",
    });
    const opportunity = resolveOwnerObligation({
      eventId: "idle-1",
      eventKind: "idle_opportunity",
      coverage: null,
      attemptOutcome: "abstained",
    });

    expect(owner.ownerObligationOutcome).toBe("unresolved");
    expect(opportunity.ownerObligationOutcome).toBe("not_applicable");
    expect(opportunity.remainingResponsibility).toBe(null);
  });
});

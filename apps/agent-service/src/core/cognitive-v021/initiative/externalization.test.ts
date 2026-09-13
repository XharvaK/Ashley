import { describe, expect, it } from "vitest";
import type { DeliveryIntent } from "../types.js";
import { evaluateExternalizationGate } from "./externalization.js";
import type { PrivateBudgetProjection } from "../private-budget/ledger.js";

const reactive: DeliveryIntent = {
  ownerId: "doc",
  channel: "discord",
  threadId: "thread-gate",
  conversationId: "thread-gate",
  trigger: "owner_message_reactive",
  deliveryLane: "reactive",
  purpose: "licensed_speech",
};

const proactive: DeliveryIntent = { ...reactive, trigger: "idle", deliveryLane: "proactive" };

function privateBudget(remaining: number): PrivateBudgetProjection {
  return {
    source: "private_budget_ledger",
    policyId: "private-v1",
    limit: 12,
    windowMs: 3_600_000,
    policyTimeMs: 1_000_000,
    lowerBoundMs: -2_600_000,
    clockState: "stable",
    discrepancyMs: 0,
    consumingCount: 12 - remaining,
    remaining,
    stateCounts: { held: 0, committed: 0, released: 0, reconcile_required: 0, expired: 0 },
  };
}

function input(deliveryIntent: DeliveryIntent, overrides: Partial<Parameters<typeof evaluateExternalizationGate>[0]> = {}) {
  return {
    deliveryIntent,
    paused: false,
    enabled: true,
    sentToday: 0,
    maxPerDay: 1,
    chatInProgress: false,
    availabilityOk: true,
    idleFloorRemainingSec: 0,
    privateBudget: privateBudget(1),
    ...overrides,
  };
}

describe("v0.2.1 externalization gate", () => {
  it("does not apply proactive controls to owner-message reactive speech", () => {
    expect(evaluateExternalizationGate(input(reactive, {
      paused: true,
      enabled: false,
      sentToday: 1,
      chatInProgress: true,
      availabilityOk: false,
      idleFloorRemainingSec: 30,
      privateBudget: privateBudget(0),
    }))).toEqual({ ok: true, reason: "ok" });
  });

  it("defers proactive speech at the daily cap", () => {
    expect(evaluateExternalizationGate(input(proactive, { sentToday: 1 }))).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("suppresses proactive speech when paused or unavailable", () => {
    expect(evaluateExternalizationGate(input(proactive, { paused: true }))).toEqual({ ok: false, reason: "proactive_paused" });
    expect(evaluateExternalizationGate(input(proactive, { availabilityOk: false }))).toEqual({ ok: false, reason: "unavailable" });
  });
});

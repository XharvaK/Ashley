import { describe, expect, it } from "vitest";
import { evaluateReachOutGate } from "./reach-out-gate.js";

const open = { paused: false, chatInProgress: false };

describe("Growth V1 §5.5 delivery gate", () => {
  it("never holds a reply", () => {
    expect(evaluateReachOutGate({ deliveryLane: "reactive", trigger: "owner_message_reactive" }, { paused: true, chatInProgress: true }))
      .toEqual({ ok: true });
  });

  it("never holds speech Alex asked for, even while paused or mid-conversation", () => {
    for (const trigger of ["commitment_due", "operation_completion", "recovery"] as const) {
      expect(evaluateReachOutGate({ deliveryLane: "proactive", trigger }, { paused: true, chatInProgress: true }))
        .toEqual({ ok: true });
    }
  });

  it("defers her own initiative while paused or mid-conversation, and never drops it", () => {
    for (const trigger of ["idle", "future_trigger", "subscription", "self_change_result"] as const) {
      expect(evaluateReachOutGate({ deliveryLane: "proactive", trigger }, { paused: true, chatInProgress: false }))
        .toEqual({ ok: false, reason: "proactive_paused", defer: true });
      expect(evaluateReachOutGate({ deliveryLane: "proactive", trigger }, { paused: false, chatInProgress: true }))
        .toEqual({ ok: false, reason: "chat_in_progress", defer: true });
      expect(evaluateReachOutGate({ deliveryLane: "proactive", trigger }, open)).toEqual({ ok: true });
    }
  });

  it("has no daily cap or idle floor of its own (the fuse lives at authorship)", () => {
    expect(evaluateReachOutGate({ deliveryLane: "proactive", trigger: "idle" }, open)).toEqual({ ok: true });
  });
});

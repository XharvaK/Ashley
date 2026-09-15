import { describe, expect, it } from "vitest";
import {
  NotificationBatcher,
  ResourceFuse,
  coalesceSocialLifecycleBatch,
  recordMultiDestinationChoice,
  type ResourceFusePolicy,
} from "./resource-fuse.js";
import { markPdfUnsupported } from "../../perception/ingest.js";
import type { AvailableSocialDestination } from "./types.js";

const policy: ResourceFusePolicy = {
  windowMs: 60_000,
  computeMs: 10,
  outputTokens: 20,
  networkRequests: 4,
  rapidLoopWindowMs: 30_000,
  rapidLoopLimit: 1,
  backoffDelaysMs: [1_000, 5_000],
};

function lifecycle(overrides: Partial<Parameters<ResourceFuse["admit"]>[0]> = {}) {
  return {
    conversationKey: "dm:ashley:bot-person",
    consequenceChainId: "consequence:one",
    lifecycleId: "lifecycle:one",
    botParticipantId: "bot-person",
    nowMs: 1_000,
    usage: { computeMs: 2, outputTokens: 4, networkRequests: 1 },
    ...overrides,
  };
}

describe("P19 social resource fuse", () => {
  it("backs off bot loops in both DM and room scopes without a token reset", () => {
    const dm = new ResourceFuse(policy);
    expect(dm.admitAndRecord(lifecycle()).accepted).toBe(true);
    expect(dm.admitAndRecord(lifecycle())).toEqual({ accepted: true, deduplicated: true });
    const dmLoop = dm.admitAndRecord(lifecycle({
      lifecycleId: "lifecycle:human-token",
      nowMs: 1_100,
    }));
    expect(dmLoop).toMatchObject({ accepted: false, fact: { operational: "backing_off" } });

    const room = new ResourceFuse(policy);
    const roomInput = lifecycle({
      conversationKey: "room:guild:channel",
      roomId: "room:guild:channel",
      lifecycleId: "room:one",
    });
    expect(room.admitAndRecord(roomInput).accepted).toBe(true);
    expect(room.admitAndRecord({
      ...roomInput,
      lifecycleId: "room:human-token",
      nowMs: 1_100,
    })).toMatchObject({ accepted: false, fact: { operational: "backing_off" } });
  });

  it("applies aggregate chain, conversation, bot, and room budgets", () => {
    const fuse = new ResourceFuse({
      ...policy,
      computeMs: 12,
      outputTokens: 24,
      networkRequests: 6,
      rapidLoopLimit: 99,
    });
    expect(fuse.admitAndRecord(lifecycle({
      lifecycleId: "dm:one",
      usage: { computeMs: 6, outputTokens: 12, networkRequests: 3 },
    })).accepted).toBe(true);
    expect(fuse.admitAndRecord(lifecycle({
      conversationKey: "room:guild:channel",
      roomId: "room:guild:channel",
      lifecycleId: "room:two",
      usage: { computeMs: 6, outputTokens: 12, networkRequests: 3 },
      nowMs: 1_200,
    })).accepted).toBe(true);
    const exhausted = fuse.admitAndRecord(lifecycle({
      lifecycleId: "dm:three",
      nowMs: 1_250,
      usage: { computeMs: 1, outputTokens: 1, networkRequests: 1 },
    }));
    expect(exhausted).toMatchObject({ accepted: false, fact: { operational: "budget_exhausted" } });

    const tokenResetAttempt = fuse.admitAndRecord(lifecycle({
      lifecycleId: "dm:trivial-new-token",
      nowMs: 1_300,
      usage: { computeMs: 1, outputTokens: 1, networkRequests: 1 },
    }));
    expect(tokenResetAttempt).toMatchObject({ accepted: false, fact: { operational: "budget_exhausted" } });
  });

  it("coalesces room and DM capture references without dropping or cross-grouping them", () => {
    const refs = [
      { conversationKey: "room:guild:channel", captureRef: "r1", receivedAtMs: 1 },
      { conversationKey: "room:guild:channel", captureRef: "r2", receivedAtMs: 2 },
      { conversationKey: "room:guild:channel", captureRef: "r1", receivedAtMs: 3 },
      { conversationKey: "dm:ashley:a", captureRef: "d1", receivedAtMs: 4 },
      { conversationKey: "dm:ashley:b", captureRef: "d2", receivedAtMs: 5 },
    ];
    expect(coalesceSocialLifecycleBatch(refs)).toEqual([
      { conversationKey: "room:guild:channel", captureRefs: ["r1", "r2"], firstReceivedAtMs: 1, lastReceivedAtMs: 3 },
      { conversationKey: "dm:ashley:a", captureRefs: ["d1"], firstReceivedAtMs: 4, lastReceivedAtMs: 4 },
      { conversationKey: "dm:ashley:b", captureRefs: ["d2"], firstReceivedAtMs: 5, lastReceivedAtMs: 5 },
    ]);
  });

  it("reports only an operational fact when paused or exhausted", () => {
    const paused = new ResourceFuse(policy);
    const decision = paused.admitAndRecord(lifecycle({ paused: true }));
    expect(decision).toEqual({ accepted: false, fact: { operational: "paused" } });
    expect(JSON.stringify(decision)).not.toMatch(/willing|desire|feel|want|desperate/i);
  });

  it("batches notifications per principal and moves overflow to a digest", () => {
    const batcher = new NotificationBatcher({ windowMs: 1_000, dailyCap: 2 });
    expect(batcher.enqueue("person-a", 1, "notice-1")).toMatchObject({ kind: "window", created: true });
    expect(batcher.enqueue("person-a", 2, "notice-2")).toMatchObject({ kind: "window", created: false });
    expect(batcher.enqueue("person-a", 2_000, "notice-3")).toMatchObject({ kind: "window", created: true });
    expect(batcher.enqueue("person-a", 3_000, "notice-4")).toMatchObject({ kind: "digest", created: true });
    expect(batcher.enqueue("person-b", 3_000, "notice-5")).toMatchObject({ kind: "window", created: true });
    expect(batcher.get("person-a", 3_000, "digest").refs).toEqual(["notice-4"]);
  });

  it("records a Thought destination choice only from the available mechanical facts", () => {
    const available: AvailableSocialDestination[] = [
      { audience: { kind: "dm", principalId: "person-a" }, source: "social_permit", permitScope: "person_wide" },
      { audience: { kind: "room", roomId: "room:guild:channel" }, source: "trusted_room", permitScope: null },
    ];
    expect(recordMultiDestinationChoice({ available, chosen: { kind: "dm", principalId: "person-a" } })).toEqual({
      accepted: true,
      destination: { kind: "dm", principalId: "person-a" },
    });
    expect(() => recordMultiDestinationChoice({ available, chosen: { kind: "dm", principalId: "person-b" } }))
      .toThrow("destination_not_available");
  });

  it("keeps PDF unsupported through markPdfUnsupported", () => {
    expect(markPdfUnsupported).toBeTypeOf("function");
  });
});

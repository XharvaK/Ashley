import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "./inbox.js";
import {
  activeThoughtMayFinishWhileDetachedCompletionQueued,
  CONVERSATION_COGNITION_OCCUPIED,
  claimConversationCognition,
  isConversationCognitionHeld,
  readConversationCognition,
  releaseConversationCognition,
  renewConversationCognition,
} from "./cognition-claim.js";

describe("per-conversation cognition claim", () => {
  it("acquires for one event and refuses a competing holder", () => {
    const sidecar = openTestSidecar();
    try {
      const first = claimConversationCognition(sidecar, {
        conversationId: "thread-claim",
        eventId: "event-1",
        wakeId: "wake-1",
        nowMs: 1_000,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(typeof first.claimToken).toBe("string");
      expect(readConversationCognition(sidecar, "thread-claim")).toMatchObject({
        holderEventId: "event-1",
        claimToken: first.claimToken,
      });
      expect(isConversationCognitionHeld(sidecar, "thread-claim", 2_000)).toBe(true);

      const second = claimConversationCognition(sidecar, {
        conversationId: "thread-claim",
        eventId: "event-2",
        nowMs: 2_000,
      });
      expect(second).toEqual({ ok: false, reason: CONVERSATION_COGNITION_OCCUPIED });
      expect(readConversationCognition(sidecar, "thread-claim")?.holderEventId).toBe("event-1");
    } finally {
      sidecar.close();
    }
  });

  it("releases only by holder token and reclaims after lease expiry", () => {
    const sidecar = openTestSidecar();
    try {
      const first = claimConversationCognition(sidecar, {
        conversationId: "thread-claim",
        eventId: "event-1",
        nowMs: 1_000,
        leaseMs: 5_000,
      });
      if (!first.ok) throw new Error("claim failed");
      // A stranger's token releases nothing.
      releaseConversationCognition(sidecar, { conversationId: "thread-claim", claimToken: "nope" });
      expect(readConversationCognition(sidecar, "thread-claim")?.holderEventId).toBe("event-1");
      // Renewal extends the live lease; foreign renewal fails.
      expect(renewConversationCognition(sidecar, {
        conversationId: "thread-claim",
        claimToken: "nope",
        nowMs: 2_000,
      })).toBe(false);
      expect(renewConversationCognition(sidecar, {
        conversationId: "thread-claim",
        claimToken: first.claimToken,
        nowMs: 2_000,
        leaseMs: 5_000,
      })).toBe(true);
      // Past the renewed lease, another event takes over.
      const takeover = claimConversationCognition(sidecar, {
        conversationId: "thread-claim",
        eventId: "event-2",
        nowMs: 8_000,
      });
      expect(takeover.ok).toBe(true);
      if (!takeover.ok) return;
      // The stale holder can neither renew nor release the successor.
      expect(renewConversationCognition(sidecar, {
        conversationId: "thread-claim",
        claimToken: first.claimToken,
        nowMs: 8_001,
      })).toBe(false);
      releaseConversationCognition(sidecar, { conversationId: "thread-claim", claimToken: first.claimToken });
      expect(readConversationCognition(sidecar, "thread-claim")?.holderEventId).toBe("event-2");
      releaseConversationCognition(sidecar, { conversationId: "thread-claim", claimToken: takeover.claimToken });
      expect(readConversationCognition(sidecar, "thread-claim")).toBe(null);
      expect(isConversationCognitionHeld(sidecar, "thread-claim", 9_000)).toBe(false);
    } finally {
      sidecar.close();
    }
  });

  it("holds different conversations independently", () => {
    const sidecar = openTestSidecar();
    try {
      expect(claimConversationCognition(sidecar, {
        conversationId: "thread-a",
        eventId: "event-a",
        nowMs: 1_000,
      }).ok).toBe(true);
      expect(claimConversationCognition(sidecar, {
        conversationId: "thread-b",
        eventId: "event-b",
        nowMs: 1_000,
      }).ok).toBe(true);
    } finally {
      sidecar.close();
    }
  });

  it("does not fence an independent store (cross-host law)", () => {
    const storeA = openTestSidecar();
    const storeB = openTestSidecar();
    try {
      expect(claimConversationCognition(storeA, {
        conversationId: "thread-shared",
        eventId: "event-a",
        nowMs: 1_000,
      }).ok).toBe(true);
      // A separate database holds no claim: the fence is per-store, so
      // independent runtimes must stay operationally excluded by deployment,
      // never by this table.
      expect(claimConversationCognition(storeB, {
        conversationId: "thread-shared",
        eventId: "event-b",
        nowMs: 1_000,
      }).ok).toBe(true);
    } finally {
      storeA.close();
      storeB.close();
    }
  });

  it("rejects malformed claims without touching the table", () => {
    const sidecar = openTestSidecar();
    try {
      expect(claimConversationCognition(sidecar, { conversationId: "", eventId: "e", nowMs: 1_000 }))
        .toEqual({ ok: false, reason: CONVERSATION_COGNITION_OCCUPIED });
      expect(claimConversationCognition(sidecar, { conversationId: "t", eventId: "", nowMs: 1_000 }))
        .toEqual({ ok: false, reason: CONVERSATION_COGNITION_OCCUPIED });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cognition_claims").get())
        .toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
    }
  });

  it("allows an active Owner Thought to finish behind a detached completion, not an Owner successor", () => {
    const sidecar = openTestSidecar();
    try {
      const active = admitTestCycle(sidecar, {
        cycleId: "cycle-queue-active",
        conversationId: "thread-queue",
        triggerKind: "owner_message",
        triggerRef: "owner-active",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const claim = claimConversationCognition(sidecar, {
        conversationId: active.conversationId,
        eventId: "owner-event-active",
        wakeId: active.wakeId,
        cycleId: active.cycleId,
        generation: active.generation,
        nowMs: 1_000,
        leaseMs: 10_000,
      });
      expect(claim.ok).toBe(true);

      appendInboxEvent(sidecar, {
        conversationId: active.conversationId,
        kind: "observation_or_receipt",
        payload: { detachedOperationId: "detached-operation:queue-1" },
        createdAtMs: 2_000,
      });
      expect(activeThoughtMayFinishWhileDetachedCompletionQueued(sidecar, {
        conversationId: active.conversationId,
        cycleId: active.cycleId,
        generation: active.generation,
        nowMs: 2_000,
      })).toBe(true);

      appendInboxEvent(sidecar, {
        conversationId: active.conversationId,
        kind: "owner_message",
        payload: { triggerRef: "owner-successor" },
        createdAtMs: 3_000,
      });
      expect(activeThoughtMayFinishWhileDetachedCompletionQueued(sidecar, {
        conversationId: active.conversationId,
        cycleId: active.cycleId,
        generation: active.generation,
        nowMs: 3_000,
      })).toBe(false);
    } finally {
      sidecar.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../cognitive-v021/evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../cognitive-v021/test-support.js";
import { claimNextInboxEvent } from "../cognitive-v021/cycle/inbox-consumer.js";
import { appendInboxEvent, getCurrentCycle } from "../cognitive-v021/cycle/inbox.js";
import { composeOrPreempt } from "../cognitive-v021/cycle/fence.js";
import { getWake } from "../cognitive-v021/wake/ledger.js";
import { domus } from "../cognitive-v021/thalamus/nuclei/domus.js";
import { runThalamusPass } from "../cognitive-v021/thalamus/integration.js";
import { buildThoughtInput } from "../cognitive-v021/thought/input.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "./store.js";
import { configureEmbodimentBudget, domusHomeFor, selectDomusNotification } from "./notification.js";
import { DOMUS_LANE_PREFIX, domusLaneId, isDomusLane } from "./lane.js";

const NOW = 10_000_000;
const HOME = "owner-thread";
const LANE = domusLaneId("owner");
const context = { budgetAvailable: true, conversationClaimHeld: false, spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 };

function armed(db: DatabaseSync) {
  configureEmbodimentBudget(db, { limit: 5, version: 1 });
  upsertHeartbeat(db, { helperSession: "helper-a", receivedAtMs: NOW - 1000, sentAtMs: NOW - 1000,
    json: JSON.stringify({ v: 1, helper_session: "helper-a", sent_at_ms: NOW - 1000, attached: true }) });
  const observationId = "helper-a.1";
  const payload = { v: 1, observation_id: observationId, world: "slot0", branch: "g1", session: "s1", attachment: "helper-a",
    body: "sim1", snapshot: "1", seq: 1, source_time_ms: NOW - 2000, expires_at_ms: NOW + 600_000, lineage_class: "CURRENT",
    percepts: [{ kind: "need", salience: 0.6, facts: { subject: "hunger", object: "low", urgency: "wake" } }] };
  admitObservation(db, { observationId, digest: observationDigest(payload), world: "slot0", branch: "g1", session: "s1",
    attachment: "helper-a", body: "sim1", snapshot: "1", seq: 1, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms,
    receiptTimeMs: NOW - 1500, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload) });
  return observationId;
}

function selectInLane(db: DatabaseSync) {
  const selected = selectDomusNotification(db, { observationId: armed(db), conversationId: LANE, homeConversationId: HOME, ownerId: "owner",
    authorityEpoch: 1, nowMs: NOW, bind: () => undefined });
  if (selected.kind !== "selected") throw new Error(`not selected: ${selected.kind}`);
  return selected.event;
}

describe("E1 the game lane", () => {
  it("is one conversation per Owner, apart from every Discord thread", () => {
    expect(LANE).toBe(`${DOMUS_LANE_PREFIX}owner`);
    expect(isDomusLane(LANE)).toBe(true);
    expect(isDomusLane(HOME)).toBe(false);
    expect(() => domusLaneId(" ")).toThrow("domus_lane_owner_required");
  });

  it("admits a game pass in the lane and addresses her words from it to the Owner's thread", () => {
    const db = openTestSidecar();
    try {
      const event = selectInLane(db);
      expect(event.conversationId).toBe(LANE);
      expect(event.payload).toMatchObject({ channel: "discord", threadId: HOME });
      expect(getCurrentCycle(db, LANE)?.triggerKind).toBe("domus_notification");
      expect(getCurrentCycle(db, HOME)).toBeNull();
      expect(domusHomeFor(db, event)).toBe(HOME);
    } finally { db.close(); }
  });

  it("an Owner message never cancels a game thought in progress", () => {
    const db = openTestSidecar();
    try {
      const event = selectInLane(db);
      const gameCycle = getCurrentCycle(db, LANE)!;
      const owner = appendOwnerUtterance(db, { conversationId: HOME, text: "why are you on the piano?", discordMessageIds: ["m-1"], nowMs: NOW + 10 });
      const fenced = composeOrPreempt(db, { conversationId: HOME, evidenceRowIds: [owner.rowId], triggerKind: "owner_message",
        occupantId: "owner", authorityEpoch: 1, nowMs: NOW + 10 });
      expect(fenced.action).toBe("compose");
      expect(getCurrentCycle(db, LANE)?.cycleId).toBe(gameCycle.cycleId);
      const wake = getWake(db, event.wakeId!)!;
      expect(wake.cancellationId).toBeNull();
      expect(wake.state).not.toBe("terminal");
    } finally { db.close(); }
  });

  it("the main worker leaves the lane to its own worker, so a game pass and a Discord turn are leased at once", () => {
    const db = openTestSidecar();
    try {
      const game = selectInLane(db);
      const turn = composeOrPreempt(db, { conversationId: HOME, triggerKind: "owner_message", occupantId: "owner", authorityEpoch: 1, nowMs: NOW });
      const ownerEvent = appendInboxEvent(db, { id: "owner-event", conversationId: HOME, kind: "owner_utterance",
        payload: { cycleId: turn.cycleId }, createdAtMs: NOW + 1, wakeId: turn.cycle.wakeId! });
      const main = claimNextInboxEvent(db, { workerId: "main", excludeConversationPrefix: DOMUS_LANE_PREFIX, nowMs: NOW + 2 });
      expect(main?.id).toBe(ownerEvent.id);
      expect(claimNextInboxEvent(db, { workerId: "main", excludeConversationPrefix: DOMUS_LANE_PREFIX, nowMs: NOW + 2 })).toBeNull();
      const lane = claimNextInboxEvent(db, { workerId: "lane", conversationId: LANE, nowMs: NOW + 2 });
      expect(lane?.id).toBe(game.id);
      expect((db.prepare("SELECT count(*) AS n FROM inbox_events WHERE state='leased'").get() as { n: number }).n).toBe(2);
    } finally { db.close(); }
  });

  it("weighs a game moment while a Discord turn holds the Owner's thread, and holds only for its own pass", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "discord-turn", conversationId: HOME, triggerKind: "owner_message", triggerRef: "turn", occupantId: "owner", nowMs: NOW - 5 });
      const candidates = domus([{ attachment: "helper-a", observations: [{ observationId: "helper-a.1", receiptTimeMs: NOW - 10, salience: 0.6, alwaysThrough: false }] }]);
      const refuse = async () => { throw new Error("must_not_run"); };
      const seen: string[] = [];
      const fired = await runThalamusPass(db, { ownerId: "owner", conversationId: LANE, nowMs: NOW, enabled: true, facts: [], candidates, context,
        executors: { afterglow: refuse, night: refuse, awake: refuse, idle: refuse, domus: async id => { seen.push(id); } } });
      expect(fired).toMatchObject({ kind: "evaluated", decision: { kind: "fire" } });
      expect(seen).toEqual(["helper-a.1"]);
      admitTestCycle(db, { cycleId: "game-pass", conversationId: LANE, triggerKind: "domus_notification", triggerRef: "game", occupantId: "owner", nowMs: NOW });
      const later = domus([{ attachment: "helper-a", observations: [{ observationId: "helper-a.2", receiptTimeMs: NOW + 50, salience: 0.6, alwaysThrough: true }] }]);
      const held = await runThalamusPass(db, { ownerId: "owner", conversationId: LANE, nowMs: NOW + 100, enabled: true, facts: [], candidates: later, context,
        executors: { afterglow: refuse, night: refuse, awake: refuse, idle: refuse, domus: refuse } });
      expect(held).toMatchObject({ kind: "evaluated", decision: { kind: "none", reason: "conversation" } });
    } finally { db.close(); }
  });

  it("a lane pass reads the Owner's last turns and thread story from its home, read-only; without a home it reads none", () => {
    const db = openTestSidecar();
    try {
      for (let i = 0; i < 3; i += 1) appendOwnerUtterance(db, { conversationId: HOME, text: `message ${i}`, discordMessageIds: [`m-${i}`], nowMs: 10 + i });
      const cycle = admitTestCycle(db, { cycleId: "lane-cycle", conversationId: LANE, triggerKind: "domus_notification", triggerRef: "lane-ref", occupantId: "owner", nowMs: 100 });
      const base = { sidecar: db, cycle, constitution: { constitutional: ["truth before performance"], stableSelf: ["curious"] },
        capabilityReality: { vision: false, attachmentText: false, conversationalRead: false, webSearch: false, canOfferProjectInspection: false,
          canOfferWorkspace: false, canOfferVerification: false, canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false,
          canOfferPatchExport: false, approvedProjectIds: [] },
        learnedSelfSlice: { dispositions: [], interests: [] } };
      const homed = buildThoughtInput({ ...base, homeConversationId: HOME });
      expect(homed.rawConversation.map(row => row.text)).toEqual(["message 0", "message 1", "message 2"]);
      expect(homed.rawConversation.every(row => row.conversationId === HOME)).toBe(true);
      expect(buildThoughtInput(base).rawConversation).toEqual([]);
    } finally { db.close(); }
  });
});

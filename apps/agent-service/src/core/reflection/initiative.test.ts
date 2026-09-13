import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { logDecision } from "../agency/log.js";
import { decide } from "../agency/decide.js";
import { openNuclearDb } from "../db.js";
import {
  beginAuthorityTransition,
  stabilizeAuthorityBarrier,
} from "../cognitive-v021/authority/barrier.js";
import type { Motivation, MotivationKind } from "../types.js";
import {
  applyInitiativeLearning,
  attachLearningSnapshot,
  calculateInitiativeAdjustment,
  processPendingReflectionEvents,
  recordInitiativeReaction,
} from "./initiative.js";
import {
  insertReflectionEvent,
  listInitiativeLearning,
  listReflectionEvents,
} from "./store.js";

function addCommittedInitiative(
  db: DatabaseSync,
  messageId: string,
  kind: MotivationKind = "question",
): void {
  const now = new Date().toISOString();
  const motivationResult = db
    .prepare(
      `INSERT INTO motivations
         (owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at)
       VALUES ('doc', ?, 50, 'test', ?, 'test motivation', ?, NULL)`,
    )
    .run(kind, messageId, now);
  const motivationId = Number(motivationResult.lastInsertRowid);
  const decisionId = logDecision(db, {
    ownerId: "doc",
    channel: "proactive",
    trigger: "proactive",
    decision: {
      trigger: "proactive",
      kind: kind === "question" ? "ask" : "share",
      motivationIds: [motivationId],
      score: 50,
      reason: "test initiative",
      evidenceRefs: [],
      uncertainty: 0,
      urgency: 0.5,
      thoughtSource: "deterministic",
      thoughtError: null,
      affectLicense: {
        permitted: false,
        valence: 0,
        activation: 0.5,
        openness: 0.5,
        tension: 0,
        reason: "neutral baseline",
      },
      cognitiveAllocation: {
        shouldSpeak: true,
        effort: "medium",
        completion: "complete",
      },
      authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
    },
  });
  db.prepare(
    `INSERT INTO initiative_reservations
       (owner_id, decision_id, text, thread_id, angle, reason,
        material_key, discord_message_id, created_at, committed_at)
     VALUES ('doc', ?, 'test message', 'thread', 'question', 'test',
             ?, ?, ?, ?)`,
  ).run(decisionId, `material:${messageId}`, messageId, now, now);
}

describe("Reflection v1 initiative learning", () => {
  it("uses the bounded corroboration formula", () => {
    expect(calculateInitiativeAdjustment(1, 0)).toBe(0);
    expect(calculateInitiativeAdjustment(2, 0)).toBe(2);
    expect(calculateInitiativeAdjustment(3, 0)).toBe(4);
    expect(calculateInitiativeAdjustment(2, 1)).toBe(0);
    expect(calculateInitiativeAdjustment(0, 5)).toBe(-8);
    expect(calculateInitiativeAdjustment(20, 0)).toBe(8);
  });

  it("records exact evidence idempotently and reconciles contradictions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    addCommittedInitiative(db, "message-1");
    addCommittedInitiative(db, "message-2");
    addCommittedInitiative(db, "message-3");

    const first = recordInitiativeReaction(db, "doc", {
      messageId: "message-1",
      emoji: "\u{1F44D}",
    });
    expect(first.event?.status).toBe("applied");
    expect(listInitiativeLearning(db, "doc")[0]?.adjustment).toBe(0);

    recordInitiativeReaction(db, "doc", {
      messageId: "message-1",
      emoji: "\u{1F44D}",
    });
    expect(listReflectionEvents(db, "doc")).toHaveLength(1);

    recordInitiativeReaction(db, "doc", {
      messageId: "message-2",
      emoji: "\u{1F44D}",
    });
    expect(listInitiativeLearning(db, "doc")[0]).toMatchObject({
      positiveCount: 2,
      negativeCount: 0,
      adjustment: 2,
      windowSize: 2,
    });

    recordInitiativeReaction(db, "doc", {
      messageId: "message-3",
      emoji: "\u{1F44E}",
    });
    expect(listInitiativeLearning(db, "doc")[0]).toMatchObject({
      positiveCount: 2,
      negativeCount: 1,
      adjustment: 0,
    });

    db.close();
  });

  it("ignores ambiguous and unmatched reactions without changing learning", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    addCommittedInitiative(db, "message-1");

    const ambiguous = recordInitiativeReaction(db, "doc", {
      messageId: "message-1",
      emoji: "\u{1F480}",
    });
    expect(ambiguous.event).toMatchObject({
      classifiedSignal: "neutral",
      status: "ignored",
      reason: "unsupported_signal",
    });
    expect(listInitiativeLearning(db, "doc")).toEqual([]);

    const unmatched = recordInitiativeReaction(db, "doc", {
      messageId: "not-an-initiative",
      emoji: "\u{1F44D}",
    });
    expect(unmatched).toEqual({ matchedInitiative: false, event: null });
    expect(listReflectionEvents(db, "doc")).toHaveLength(1);

    db.close();
  });

  it("replays pending evidence and applies learning only in apply mode", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const event = insertReflectionEvent(db, {
      ownerId: "doc",
      kind: "initiative_reaction",
      sourceKey: "pending-event",
      decisionId: 1,
      reservationId: 1,
      discordMessageId: "message-1",
      subjectKind: "question",
      rawSignal: "\u{1F44D}",
      classifiedSignal: "positive",
      classifierVersion: 1,
      status: "pending",
      reason: "eligible",
      detailJson: "{}",
      createdAt: new Date().toISOString(),
      processedAt: null,
    });
    insertReflectionEvent(db, {
      ownerId: "doc",
      kind: "initiative_reaction",
      sourceKey: "pending-event-2",
      decisionId: 2,
      reservationId: 2,
      discordMessageId: "message-2",
      subjectKind: "question",
      rawSignal: "\u{1F44D}",
      classifiedSignal: "positive",
      classifierVersion: 1,
      status: "pending",
      reason: "eligible",
      detailJson: "{}",
      createdAt: new Date().toISOString(),
      processedAt: null,
    });

    processPendingReflectionEvents(db);
    expect(listReflectionEvents(db, "doc").every((row) => row.status === "applied")).toBe(true);
    expect(listInitiativeLearning(db, "doc")[0]?.lastEventId).toBeGreaterThanOrEqual(event.id);

    const motivations: Motivation[] = [
      { id: 10, kind: "question", score: 24, summary: "ask something" },
    ];
    const observed = applyInitiativeLearning(
      db,
      "doc",
      motivations,
      "observe",
    );
    expect(observed[0]).toMatchObject({
      baseScore: 24,
      score: 24,
      learningAdjustment: 0,
    });

    const applied = applyInitiativeLearning(db, "doc", motivations, "apply");
    expect(applied[0]).toMatchObject({
      baseScore: 24,
      score: 26,
      learningAdjustment: 2,
      learningAuthorityClass: "MECHANICAL_CALIBRATION",
    });
    const decision = attachLearningSnapshot(
      decide(applied, "proactive"),
      applied,
    );
    expect(decision.kind).toBe("ask");
    expect(decision.learning).toMatchObject({
      subjectKind: "question",
      adjustment: 2,
      authorityClass: "MECHANICAL_CALIBRATION",
    });

    db.close();
  });

  it("fences initiative calibration while the authority barrier is transitioning", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    insertReflectionEvent(db, {
      ownerId: "doc",
      kind: "initiative_reaction",
      sourceKey: "fenced-pending-event",
      decisionId: 1,
      reservationId: 1,
      discordMessageId: "fenced-message",
      subjectKind: "question",
      rawSignal: "\u{1F44D}",
      classifiedSignal: "positive",
      classifierVersion: 1,
      status: "pending",
      reason: "eligible",
      detailJson: "{}",
      createdAt: new Date().toISOString(),
      processedAt: null,
    });
    const transition = beginAuthorityTransition(
      db,
      "p5_reflection_fence_test",
      Date.now(),
    );
    expect(() => processPendingReflectionEvents(db)).toThrow(
      "authority_barrier_not_stable",
    );
    expect(listInitiativeLearning(db, "doc")).toEqual([]);
    expect(listReflectionEvents(db, "doc")[0]?.status).toBe("pending");
    stabilizeAuthorityBarrier(db, transition.vector, Date.now(), transition.transitionId);
    processPendingReflectionEvents(db);
    expect(listInitiativeLearning(db, "doc")[0]).toMatchObject({
      adjustment: 0,
      lastEventId: expect.any(Number),
    });
    db.close();
  });

  it("derives calibration from only the latest twenty eligible events", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    for (let index = 0; index < 21; index += 1) {
      const messageId = `window-${index}`;
      addCommittedInitiative(db, messageId);
      recordInitiativeReaction(db, "doc", {
        messageId,
        emoji: index === 0 ? "\u{1F44E}" : "\u{1F44D}",
      });
    }

    expect(listInitiativeLearning(db, "doc")[0]).toMatchObject({
      positiveCount: 20,
      negativeCount: 0,
      adjustment: 8,
      windowSize: 20,
    });

    db.close();
  });
});

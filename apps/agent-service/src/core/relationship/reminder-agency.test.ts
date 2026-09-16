import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { logDecision } from "../agency/log.js";
import { collectMotivations } from "../agency/motivations.js";
import { tryClaimRelationshipMotivation } from "./claims.js";
import { upsertDocReminder } from "./store.js";
import { applyRelationshipDeliveryOutcome, markMissedDueReminders } from "./delivery-outcomes.js";
import { env } from "../../env.js";

describe("reminder agency claims", () => {
  it("does not fulfill a reminder for a partial delivery outcome", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const reminderUuid = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Water plants",
      dueAt: "2026-09-15T12:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "partial-reminder",
      classification: "ordinary",
      status: "due",
    });
    const motivationId = Number(db.prepare(
      `INSERT INTO motivations
         (owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at, data_classification)
       VALUES (?, 'callback', 1, 'doc_reminder', ?, ?, ?, NULL, NULL)`,
    ).run("doc", reminderUuid, "Water plants", new Date().toISOString()).lastInsertRowid);
    const decisionId = logDecision(db, {
      ownerId: "doc",
      channel: "discord",
      trigger: "proactive",
      decision: {
        trigger: "proactive",
        kind: "speak",
        motivationIds: [motivationId],
        score: 1,
        reason: "reminder delivery test",
        evidenceRefs: [{ type: "doc_reminder", id: reminderUuid }],
        uncertainty: 0,
        urgency: 1,
        thoughtSource: "deterministic",
        thoughtError: null,
        affectLicense: { permitted: false, valence: 0, activation: 0, openness: 0, tension: 0, reason: "test" },
        cognitiveAllocation: { shouldSpeak: true, effort: "low", completion: "complete" },
        authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
      },
    });

    applyRelationshipDeliveryOutcome(db, {
      ownerId: "doc",
      decisionId,
      cause: "complete",
      state: "partially_delivered",
      receiptCount: 1,
    });
    expect(db.prepare("SELECT status FROM doc_reminders WHERE entity_uuid = ?").get(reminderUuid)).toEqual({ status: "due" });

    applyRelationshipDeliveryOutcome(db, {
      ownerId: "doc",
      decisionId,
      cause: "complete",
      state: "committed",
      receiptCount: 1,
    });
    expect(db.prepare("SELECT status FROM doc_reminders WHERE entity_uuid = ?").get(reminderUuid)).toEqual({ status: "fulfilled" });
    db.close();
    continuity.close();
  });

  it("dedupes active claims", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const reminderUuid = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Water plants",
      dueAt: "2020-01-01T00:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
      classification: "ordinary",
      status: "due",
    });
    expect(
      tryClaimRelationshipMotivation(db, {
        ownerId: "doc",
        relationshipEntityType: "doc_reminder",
        relationshipEntityUuid: reminderUuid,
        motivationId: 1,
      }),
    ).toBe(true);
    expect(
      tryClaimRelationshipMotivation(db, {
        ownerId: "doc",
        relationshipEntityType: "doc_reminder",
        relationshipEntityUuid: reminderUuid,
        motivationId: 2,
      }),
    ).toBe(false);
    db.close();
    continuity.close();
  });

  it("marks missed after grace window", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const reminderUuid = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Old task",
      dueAt: "2020-01-01T00:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-2",
      classification: "ordinary",
      status: "due",
    });
    const missed = markMissedDueReminders(
      db,
      "doc",
      "2026-01-01T00:00:00.000Z",
      env.reminderMissedGraceHours,
    );
    expect(missed).toBe(1);
    const row = db
      .prepare(`SELECT status FROM doc_reminders WHERE entity_uuid = ?`)
      .get(reminderUuid) as { status?: string };
    expect(row.status).toBe("missed");
    db.close();
    continuity.close();
  });

  it("does not surface reminder motivations in observe mode", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    upsertDocReminder(db, {
      ownerId: "doc",
      text: "Call mom",
      dueAt: "2020-01-01T00:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-3",
      classification: "ordinary",
      status: "due",
    });
    const motivations = collectMotivations(db, "doc", "proactive");
    expect(motivations.some((item) => item.kind === "reminder")).toBe(false);
    db.close();
    continuity.close();
  });
});

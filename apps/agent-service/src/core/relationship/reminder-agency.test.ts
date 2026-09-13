import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { collectMotivations } from "../agency/motivations.js";
import { tryClaimRelationshipMotivation } from "./claims.js";
import { upsertDocReminder } from "./store.js";
import { markMissedDueReminders } from "./delivery-outcomes.js";
import { env } from "../../env.js";

describe("reminder agency claims", () => {
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

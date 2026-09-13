import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { upsertDocReminder, listDueDocReminders } from "./store.js";
import { recordWithdrawal } from "./authority.js";
import { evaluateWithdrawalSilence } from "./repair.js";

describe("relationship store", () => {
  it("creates idempotent doc reminders by source uuid", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const uuid = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Water the plants",
      dueAt: "2026-08-04T10:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
      classification: "ordinary",
    });
    const again = upsertDocReminder(db, {
      ownerId: "doc",
      text: "Water the plants",
      dueAt: "2026-08-04T10:00:00.000Z",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
      classification: "ordinary",
    });
    expect(again).toBe(uuid);
    const due = listDueDocReminders(db, "doc", "2026-08-04T12:00:00.000Z");
    expect(due).toHaveLength(1);
    db.close();
    continuity.close();
  });

  it("records withdrawal and evaluates silence regardless of optional influence mode", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    recordWithdrawal(db, {
      ownerId: "doc",
      initiator: "doc",
      scope: "turn",
      reason: "need space",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-space",
    });
    expect(
      evaluateWithdrawalSilence(db, "doc", "observe", "hello"),
    ).toBe("withdrawal_turn");
    db.close();
    continuity.close();
  });
});

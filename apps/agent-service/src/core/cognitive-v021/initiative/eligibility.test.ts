import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { env } from "../../../env.js";
import { currentReleaseId } from "../../rollout/capabilities.js";
import { upsertMindStateItem } from "../../state/mind-items.js";
import { openOwnTimeSession } from "../../state/own-time.js";
import { patchState } from "../../state/store.js";
import {
  classifyInitiativeClass,
  evaluateProactiveEligibility,
} from "./eligibility.js";

function activateCapabilities(db: DatabaseSync, names: string[]): void {
  const releaseId = currentReleaseId();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at)
     VALUES (?, ?, 'active', ?, ?)`,
  );
  for (const name of names) insert.run(name, releaseId, now, now);
}

describe("proactive eligibility", () => {
  it("blocks ordinary initiative on idle floor but allows urgent_grounded", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateCapabilities(db, [
        "recall",
        "mind_state",
        "thought",
        "relational_initiative",
      ]);
      patchState(db, "doc", { availability: "available", focus: null });
      const recent = new Date().toISOString();
      const ordinary = evaluateProactiveEligibility(db, {
        ownerId: "doc",
        chatInProgress: false,
        paused: false,
        sentToday: 0,
        maxPerDay: 10,
        lastUserMessageAt: recent,
        minIdleHours: 2,
        hasUrgent: false,
      });
      expect(ordinary).toMatchObject({
        ok: false,
        reason: "idle_floor",
        initiativeClass: "ordinary",
      });

      upsertMindStateItem(db, {
        ownerId: "doc",
        kind: "concern",
        text: "Urgent concern.",
        sourceType: "episode",
        sourceId: 1,
        urgency: 1,
      });
      expect(classifyInitiativeClass(db, "doc")).toBe("urgent_grounded");
      const urgent = evaluateProactiveEligibility(db, {
        ownerId: "doc",
        chatInProgress: false,
        paused: false,
        sentToday: 0,
        maxPerDay: 10,
        lastUserMessageAt: recent,
        minIdleHours: 2,
        hasUrgent: true,
      });
      expect(urgent).toEqual({ ok: true, initiativeClass: "urgent_grounded" });
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("blocks both classes during open own-time", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    openOwnTimeSession(db, "doc", 1);
    for (const hasUrgent of [false, true]) {
      const result = evaluateProactiveEligibility(db, {
        ownerId: "doc",
        chatInProgress: false,
        paused: false,
        sentToday: 0,
        maxPerDay: 10,
        lastUserMessageAt: null,
        minIdleHours: 0,
        hasUrgent,
      });
      expect(result).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
    }
    db.close();
  });
});

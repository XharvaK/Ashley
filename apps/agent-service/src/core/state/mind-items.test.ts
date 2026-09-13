import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  claimUrgentMindState,
  consumeUrgentWake,
  hasUrgentMindState,
  listActiveMindStateItems,
  retryUrgentWake,
  upsertMindStateItem,
} from "./mind-items.js";

describe("urgent Mind State lifecycle", () => {
  it("consumes one edge and rearms only for a material update", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const input = {
      ownerId: "doc",
      kind: "concern" as const,
      text: "Check the release blocker.",
      sourceType: "episode",
      sourceId: 1,
      activation: 1,
      urgency: 0.85,
    };
    const id = upsertMindStateItem(db, input);
    expect(hasUrgentMindState(db, "doc")).toBe(true);
    expect(claimUrgentMindState(db, "doc")).toMatchObject({
      id,
      wakeState: "claimed",
      wakeAttempts: 1,
    });
    expect(hasUrgentMindState(db, "doc")).toBe(false);
    consumeUrgentWake(db, id);
    expect(listActiveMindStateItems(db, "doc")[0]?.wakeState).toBe("consumed");

    upsertMindStateItem(db, input);
    expect(hasUrgentMindState(db, "doc")).toBe(false);
    upsertMindStateItem(db, { ...input, urgency: 1 });
    expect(hasUrgentMindState(db, "doc")).toBe(true);
    const claimedAgain = claimUrgentMindState(db, "doc");
    consumeUrgentWake(db, claimedAgain!.id);

    upsertMindStateItem(db, { ...input, urgency: 0.7 });
    expect(hasUrgentMindState(db, "doc")).toBe(false);
    upsertMindStateItem(db, { ...input, urgency: 0.86 });
    expect(hasUrgentMindState(db, "doc")).toBe(true);
    db.close();
  });

  it("retries pre-decision failures with increasing backoff", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const id = upsertMindStateItem(db, {
      ownerId: "doc",
      kind: "commitment",
      text: "Follow up now.",
      sourceType: "episode",
      sourceId: 2,
      urgency: 1,
    });
    claimUrgentMindState(db, "doc");
    retryUrgentWake(db, id);
    const first = listActiveMindStateItems(db, "doc")[0]!;
    expect(first.wakeState).toBe("pending");
    expect(Date.parse(first.nextWakeAt!) - Date.now()).toBeGreaterThan(4 * 60_000);

    db.prepare(
      "UPDATE mind_state_items SET next_wake_at = ? WHERE id = ?",
    ).run(new Date(0).toISOString(), id);
    claimUrgentMindState(db, "doc");
    retryUrgentWake(db, id);
    const second = listActiveMindStateItems(db, "doc")[0]!;
    expect(second.wakeAttempts).toBe(2);
    expect(Date.parse(second.nextWakeAt!) - Date.now()).toBeGreaterThan(9 * 60_000);
    db.close();
  });
});

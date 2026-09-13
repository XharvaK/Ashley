import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import { recordWithdrawal } from "./authority.js";
import {
  activeWithdrawal,
  consumeActiveTurnWithdrawal,
  evaluateWithdrawalSilence,
  markRepairBackoff,
} from "./repair.js";

describe("withdrawal repair", () => {
  it("consumes turn scope once and respects precedence", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    recordWithdrawal(db, {
      ownerId: "doc",
      initiator: "doc",
      scope: "turn",
      reason: "busy",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
    });
    if (capabilityCanInfluence(db, "relationship_state", "apply")) {
      expect(evaluateWithdrawalSilence(db, "doc", "apply", "hello")).toBe(
        "withdrawal_turn",
      );
      consumeActiveTurnWithdrawal(db, "doc");
      expect(evaluateWithdrawalSilence(db, "doc", "apply", "hello")).toBeNull();
    } else {
      expect(evaluateWithdrawalSilence(db, "doc", "observe", "hello")).toBe("withdrawal_turn");
    }
    expect(activeWithdrawal(db, "doc")).toBeTruthy();
    db.close();
    continuity.close();
  });

  it("marks repair backoff terminal", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const uuid = recordWithdrawal(db, {
      ownerId: "doc",
      initiator: "doc",
      scope: "relationship_pause",
      reason: "need space",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-2",
    });
    db.prepare(
      `UPDATE withdrawal_records SET repair_status = 'attempted' WHERE entity_uuid = ?`,
    ).run(uuid);
    markRepairBackoff(db, uuid);
    const row = db
      .prepare(`SELECT repair_status FROM withdrawal_records WHERE entity_uuid = ?`)
      .get(uuid) as { repair_status?: string };
    expect(row.repair_status).toBe("backoff");
    db.close();
    continuity.close();
  });
});

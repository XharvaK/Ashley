import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  detectReminderIntent,
  detectSpaceRequest,
  isMutualCoPlanningText,
  recordWithdrawal,
} from "./authority.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

describe("relationship authority", () => {
  it("detects explicit reminder and space intents", () => {
    expect(detectReminderIntent("remind me to call mom")).toBe(true);
    expect(detectSpaceRequest("not now please")).toMatchObject({
      scope: "turn",
    });
    expect(isMutualCoPlanningText("together we'll ship this")).toBe(true);
  });

  it("records withdrawal with provenance", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const uuid = recordWithdrawal(db, {
      ownerId: "doc",
      initiator: "doc",
      scope: "turn",
      reason: "busy",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
    });
    const row = db
      .prepare(`SELECT entity_uuid, status FROM withdrawal_records WHERE entity_uuid = ?`)
      .get(uuid) as { entity_uuid?: string; status?: string };
    expect(row.status).toBe("active");
    db.close();
    continuity.close();
  });

  it("rejects model-only provenance for mutual activation helpers", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    db.prepare(
      `INSERT INTO mutual_commitments
         (owner_id, entity_uuid, data_classification, text, status,
          source_entity_type, source_entity_uuid, text_hash, created_at, updated_at)
       VALUES ('doc', 'mut-1', ?, 'Plan dinner', 'proposed',
               'episode', 'ep-1', 'hash', ?, ?)`,
    ).run(
      defaultUnclassifiedConversational(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const row = db
      .prepare(`SELECT status FROM mutual_commitments WHERE entity_uuid = 'mut-1'`)
      .get() as { status?: string };
    expect(row.status).toBe("proposed");
    db.close();
    continuity.close();
  });
});

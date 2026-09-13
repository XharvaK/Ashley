import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "./conversation-log.js";
import { openTestSidecar } from "../test-support.js";
import { projectConversationEvidence } from "./compatibility-projector.js";

describe("v0.2.1 evidence compatibility projector", () => {
  it("projects owner evidence and only delivered Ashley evidence, idempotently", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    appendOwnerUtterance(sidecar, {
      conversationId: "conversation-compat", text: "owner evidence", discordMessageIds: ["owner-compat"], nowMs: 1,
    });
    appendAshleyEvidence(sidecar, {
      conversationId: "conversation-compat", text: "delivered legacy", discordMessageIds: ["ashley-compat"], reservationId: 7, delivered: true, architectureEpoch: "legacy", nowMs: 2,
    });
    appendAshleyEvidence(sidecar, {
      conversationId: "conversation-compat", text: "undelivered draft", discordMessageIds: [], reservationId: 8, delivered: false, nowMs: 3,
    });

    const first = projectConversationEvidence(sidecar, nuclear, {
      ownerId: "doc", conversationId: "conversation-compat", cutover: true,
    });
    const second = projectConversationEvidence(sidecar, nuclear, {
      ownerId: "doc", conversationId: "conversation-compat", cutover: true,
    });
    expect(first).toMatchObject({ projected: 2, skippedDrafts: 1, replayed: 0 });
    expect(second).toMatchObject({ projected: 0, skippedDrafts: 1, replayed: 2 });
    expect(nuclear.prepare("SELECT role, text FROM mem_messages ORDER BY id").all()).toEqual([
      { role: "user", text: "owner evidence" },
      { role: "assistant", text: "delivered legacy" },
    ]);
    nuclear.close(); sidecar.close();
  });

  it("requires an explicit cutover gate", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    appendOwnerUtterance(sidecar, { conversationId: "conversation-compat", text: "not yet", nowMs: 1 });
    expect(projectConversationEvidence(sidecar, nuclear, { ownerId: "doc", conversationId: "conversation-compat" })).toMatchObject({
      projected: 0, reason: "cutover_not_active",
    });
    expect(nuclear.prepare("SELECT COUNT(*) AS count FROM mem_messages").get()).toMatchObject({ count: 0 });
    nuclear.close(); sidecar.close();
  });
});

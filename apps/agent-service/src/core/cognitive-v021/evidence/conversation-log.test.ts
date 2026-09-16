import { describe, expect, it } from "vitest";
import {
  appendExternalUtteranceInTransaction,
  appendOwnerUtterance,
  appendSystemEvent,
  getConversationEvidence,
  listConversationEvidence,
} from "./conversation-log.js";
import { openTestSidecar } from "../test-support.js";

describe("v0.2.1 conversation evidence log", () => {
  it("preserves rapid owner messages as separate evidence rows", () => {
    const db = openTestSidecar();
    try {
      const first = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "HY4",
        discordMessageIds: ["discord-1"],
        nowMs: 1,
      });
      const second = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "I meant HY3",
        discordMessageIds: ["discord-2"],
        nowMs: 2,
      });
      const third = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "it’s an LLM",
        discordMessageIds: ["discord-3"],
        nowMs: 3,
      });

      expect(new Set([first.rowId, second.rowId, third.rowId]).size).toBe(3);
      expect(listConversationEvidence(db, "thread-1").map((row) => row.text)).toEqual([
        "HY4",
        "I meant HY3",
        "it’s an LLM",
      ]);
      expect(new Set([first.contentHash, second.contentHash, third.contentHash]).size).toBe(3);
    } finally {
      db.close();
    }
  });

  it("deduplicates inbound ids, supports merged fragments, and versions explicit edits", () => {
    const db = openTestSidecar();
    try {
      const merged = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "merged turn",
        discordMessageIds: ["d1", "d2", "d3"],
        nowMs: 10,
      });
      const duplicate = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "should not be inserted",
        discordMessageIds: ["d2"],
        nowMs: 11,
      });
      const edit = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "edited merged turn",
        discordMessageIds: ["d2"],
        editOfRowId: merged.rowId,
        nowMs: 12,
      });

      expect(duplicate.rowId).toBe(merged.rowId);
      expect(edit.lineageId).toBe(merged.lineageId);
      expect(edit.version).toBe(2);
      expect(db.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_discord_ids").get()).toMatchObject({ count: 3 });
      expect(listConversationEvidence(db, "thread-1")).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("redacts credential-shaped owner text before sidecar persistence", () => {
    const db = openTestSidecar();
    try {
      const row = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "Authorization: Bearer eyJheader.eyJpayload.signature",
        discordMessageIds: ["secret-1"],
      });
      expect(row.dataClassification).toBe("secret");
      expect(row.secretOmitted).toBe(true);
      expect(row.text).toBe("[credential omitted]");
      expect(db.prepare("SELECT text FROM conversation_evidence_log").get()).toMatchObject({ text: "[credential omitted]" });
    } finally {
      db.close();
    }
  });

  it("writes system evidence with explicit classification", () => {
    const db = openTestSidecar();
    try {
      const row = appendSystemEvent(db, {
        conversationId: "thread-1",
        text: "system event",
        dataClassification: "ordinary",
      });
      expect(row.role).toBe("system");
      expect(row.dataClassification).toBe("ordinary");
    } finally {
      db.close();
    }
  });

  it("preserves unknown audience provenance when the stored value is NULL", () => {
    const db = openTestSidecar();
    try {
      const unknown = appendOwnerUtterance(db, {
        conversationId: "thread-unknown-audience",
        text: "audience was not captured",
      });
      const ownerPrivate = appendOwnerUtterance(db, {
        conversationId: "thread-known-audience",
        text: "audience was explicitly private",
        audienceAtCapture: "owner_private",
      });

      expect(unknown.audienceAtCapture).toBe("unknown");
      expect(ownerPrivate.audienceAtCapture).toBe("owner_private");
      expect(db.prepare(
        "SELECT audience_at_capture FROM conversation_evidence_log WHERE row_id = ?",
      ).get(unknown.rowId)).toEqual({ audience_at_capture: null });
      expect(db.prepare(
        "SELECT audience_at_capture FROM conversation_evidence_log WHERE row_id = ?",
      ).get(ownerPrivate.rowId)).toEqual({ audience_at_capture: "owner_private" });
    } finally {
      db.close();
    }
  });

  it("rejects malformed speaker attribution without Owner-defaulting or persisting it", () => {
    const db = openTestSidecar();
    try {
      expect(() => appendExternalUtteranceInTransaction(db, {
        conversationId: "thread-1",
        text: "unattributed external text",
        discordMessageIds: ["malformed-speaker-1"],
        speakerPrincipalId: "person-1",
      })).toThrow("speaker_kind_invalid");
      expect(db.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toEqual({ count: 0 });

      const owner = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "owner text",
      });
      db.prepare("UPDATE conversation_evidence_log SET speaker_kind = NULL WHERE row_id = ?").run(owner.rowId);
      expect(getConversationEvidence(db, owner.rowId)).toBeNull();
      expect(listConversationEvidence(db, "thread-1")).toEqual([]);
    } finally {
      db.close();
    }
  });
});

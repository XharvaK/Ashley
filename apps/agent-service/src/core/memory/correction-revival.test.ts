import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  listActiveFacts,
  factInfluenceEligibleAt,
  factInfluenceEligibleUnderAssertionsAt,
  upsertFact,
} from "./facts.js";
import {
  assembleMemoryBlock,
} from "./assemble.js";
import {
  insertMessage,
  resolveActiveThread,
} from "./threads.js";
import {
  listActiveMindStateItems,
  upsertMindStateItem,
} from "../state/mind-items.js";

const OWNER_ID = "doc";

describe("C1 current-source gap characterization", () => {
  it("legacy fact reads still return a fact after a correction-shaped owner message", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
      });
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "I no longer like coffee.",
        channel: "discord",
      });

      expect(listActiveFacts(db, OWNER_ID).map((fact) => fact.id)).toContain(factId);
    } finally {
      db.close();
    }
  });

  it("the legacy Mind State reader still returns an active item", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const itemId = upsertMindStateItem(db, {
        ownerId: OWNER_ID,
        kind: "concern",
        text: "stale concern",
        sourceType: "episode",
        sourceId: "1",
      });

      expect(listActiveMindStateItems(db, OWNER_ID).map((item) => item.id)).toContain(itemId);
    } finally {
      db.close();
    }
  });

  it("the legacy hot window contains correction-shaped text as raw provider input", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "I no longer like coffee.",
        channel: "discord",
      });

      const assembled = assembleMemoryBlock(db, OWNER_ID);
      const hotMessage = assembled.hotMessages.find((message) => message.id === messageId);

      expect(hotMessage?.text).toBe("I no longer like coffee.");
      expect(assembled.memoryBlock).toContain("user: I no longer like coffee.");
      expect(assembled.memoryBlock).not.toContain("memory_context_role");
    } finally {
      db.close();
    }
  });

  it("keeps raw assertion eligibility available without changing the legacy marker path", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "tea",
        value: "likes tea",
        origin: "explicit_user",
      });

      expect(factInfluenceEligibleUnderAssertionsAt(db, OWNER_ID, factId)).toBe(true);
      expect(factInfluenceEligibleAt(db, OWNER_ID, factId)).toBe(true);
    } finally {
      db.close();
    }
  });
});

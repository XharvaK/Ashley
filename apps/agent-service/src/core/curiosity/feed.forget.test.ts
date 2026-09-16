import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { confirmV021Forget, previewV021Forget } from "../cognitive-v021/commands.js";
import { insertItem, insertTake, upsertSource } from "./feed.js";

describe("curiosity forget eligibility", () => {
  it("previews, redacts, and does not revive a forgotten take or item", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const sidecar = openTestSidecar();
    try {
      const sourceId = upsertSource(nuclear, {
        slug: "forget-source",
        title: "Forget source",
        kind: "rss",
        url: "https://example.test/forget-feed.xml",
        interest: "forgotten curiosity",
      });
      const itemId = insertItem(nuclear, {
        sourceId,
        url: "https://example.test/forgotten-curiosity",
        title: "Forgotten curiosity title",
        excerpt: "Forgotten curiosity excerpt",
        interest: "forgotten curiosity",
      });
      if (itemId == null) throw new Error("curiosity_item_missing");
      const takeId = insertTake(nuclear, {
        itemId,
        interest: "forgotten curiosity",
        take: "Forgotten curiosity take",
        evidenceKind: "scan_excerpt",
      });
      if (takeId == null) throw new Error("curiosity_take_missing");
      expect(nuclear.prepare(
        `SELECT t.id
         FROM cur_takes t
         JOIN cur_items i ON i.id = t.item_id
         WHERE LOWER(t.take) LIKE ? OR LOWER(i.title) LIKE ?
            OR LOWER(i.excerpt) LIKE ? OR LOWER(i.url) LIKE ?`,
      ).all("%forgotten curiosity%", "%forgotten curiosity%", "%forgotten curiosity%", "%forgotten curiosity%")).toHaveLength(1);
      const preview = previewV021Forget(sidecar, nuclear, continuity, {
        ownerId: "doc",
        topic: "forgotten curiosity",
        nowMs: 1,
      });
      expect(preview.previewId).toEqual(expect.any(String));
      expect(preview.categoryCounts).toMatchObject({ cur_takes: 1 });
      const previewId = preview.previewId;
      if (!previewId) throw new Error("curiosity_preview_missing");

      const result = confirmV021Forget(sidecar, nuclear, continuity, {
        ownerId: "doc",
        previewId,
        nowMs: 2,
      });
      expect(result.tombstoneId).toEqual(expect.any(String));
      expect(nuclear.prepare("SELECT take, interest FROM cur_takes WHERE id = ?").get(takeId)).toEqual({
        take: "[redacted]",
        interest: "[redacted]",
      });
      expect(nuclear.prepare("SELECT title, excerpt FROM cur_items WHERE id = ?").get(itemId)).toEqual({
        title: "[redacted]",
        excerpt: "[redacted]",
      });

      expect(insertTake(nuclear, {
        itemId,
        interest: "new interest",
        take: "A revived take must not return",
        evidenceKind: "read_record",
        readId: null,
      })).toBeNull();
      expect(insertItem(nuclear, {
        sourceId,
        url: "https://example.test/forgotten-curiosity",
        title: "Same URL must not revive",
        excerpt: "Same URL must remain latched",
        interest: "forgotten curiosity",
      })).toBeNull();

      const freshItemId = insertItem(nuclear, {
        sourceId,
        url: "https://example.test/new-curiosity-url",
        title: "Fresh forgotten curiosity information",
        excerpt: "Independent later material",
        interest: "forgotten curiosity",
      });
      expect(freshItemId).toEqual(expect.any(Number));
      expect(insertTake(nuclear, {
        itemId: freshItemId!,
        interest: "forgotten curiosity",
        take: "Fresh independent take",
        evidenceKind: "scan_excerpt",
      })).toEqual(expect.any(Number));
    } finally {
      sidecar.close();
      nuclear.close();
      continuity.close();
    }
  });
});

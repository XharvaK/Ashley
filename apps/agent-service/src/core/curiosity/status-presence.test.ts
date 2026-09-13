import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { AshleyCore } from "../runtime.js";
import { insertItem, insertTake, upsertSource } from "./feed.js";
import {
  beginCurrentActivity,
  clearCurrentActivity,
} from "./current-activity.js";

afterEach(() => {
  clearCurrentActivity();
});

describe("curiosity status presence projection", () => {
  it("does not treat a persisted take as currently reading", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const core = new AshleyCore(db);
    const sourceId = upsertSource(db, {
      slug: "test",
      title: "Test",
      kind: "rss",
      url: "https://example.com/feed.xml",
      interest: "systems",
    });
    const itemId = insertItem(db, {
      sourceId,
      url: "https://example.com/article",
      title: "The Left Hand of Darkness",
      excerpt: "excerpt",
      interest: "systems",
    })!;
    insertTake(db, {
      itemId,
      interest: "systems",
      take: "A stored take is not live thought.",
      evidenceKind: "read_record",
    });
    const status = core.getCuriosityStatus("doc");
    expect(status.presence.lastTake?.title).toBe("The Left Hand of Darkness");
    expect(status.presence.currentActivity).toEqual({ state: "none" });
    beginCurrentActivity({
      state: "active",
      kind: "reading",
      id: "read:in-flight",
      title: "The Left Hand of Darkness",
      startedAt: "2026-08-26T00:00:00.000Z",
    });
    expect(core.getCuriosityStatus("doc").presence.currentActivity).toMatchObject({
      state: "active",
      kind: "reading",
      id: "read:in-flight",
    });
    const before = db
      .prepare("SELECT focus, availability, updated_at FROM internal_state WHERE owner_id = ?")
      .get("doc");
    core.getCuriosityStatus("doc");
    const after = db
      .prepare("SELECT focus, availability, updated_at FROM internal_state WHERE owner_id = ?")
      .get("doc");
    expect(after).toEqual(before);
    clearCurrentActivity();
    expect(core.getCuriosityStatus("doc").presence.currentActivity).toEqual({
      state: "none",
    });
    db.close();
  });
});

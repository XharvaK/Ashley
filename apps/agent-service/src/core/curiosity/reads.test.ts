import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertItem, upsertSource } from "./feed.js";
import {
  clearCurrentActivity,
  getCurrentActivity,
} from "./current-activity.js";
import { listRecentReads, performGroundedReads, recordSuccessfulRead } from "./reads.js";

describe("curiosity read provenance", () => {
  it("stores bounded evidence only for a successful full read", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
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
      title: "Article",
      excerpt: "A feed excerpt.",
      interest: "systems",
    })!;
    const readId = recordSuccessfulRead(db, {
      itemId,
      finalUrl: "https://example.com/article",
      contentHash: "a".repeat(64),
      model: "test-model",
      modelMetadata: { provider: "test" },
      evidenceExcerpts: Array.from({ length: 8 }, (_, index) =>
        `${index} ${"x".repeat(600)}`,
      ),
      cleanedChars: 80_000,
    });

    expect(readId).toBeGreaterThan(0);
    expect(listRecentReads(db)).toEqual([
      expect.objectContaining({
        id: readId,
        title: "Article",
        contentHash: "a".repeat(64),
        cleanedChars: 50_000,
        modelMetadata: { provider: "test" },
        evidenceExcerpts: expect.arrayContaining([expect.stringMatching(/^0 /)]),
      }),
    ]);
    expect(listRecentReads(db)[0]?.evidenceExcerpts).toHaveLength(6);
    expect(listRecentReads(db)[0]?.evidenceExcerpts[0]?.length).toBe(500);
    db.close();
  });

  it("permits ten interest reads and two unfamiliar-topic reads per UTC day", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const interestSource = upsertSource(db, {
      slug: "interest", title: "Interest", kind: "rss",
      url: "https://example.com/interest.xml", interest: "systems",
    });
    const explorationSource = upsertSource(db, {
      slug: "explore", title: "Explore", kind: "rss",
      url: "https://example.com/explore.xml", interest: "wildcard",
    });
    for (let index = 0; index < 11; index++) {
      insertItem(db, {
        sourceId: interestSource,
        url: `https://example.com/interest-${index}`,
        title: `Interest ${index}`,
        excerpt: "excerpt",
        interest: "systems",
        score: 100 - index,
      });
    }
    for (let index = 0; index < 3; index++) {
      insertItem(db, {
        sourceId: explorationSource,
        url: `https://example.com/explore-${index}`,
        title: `Explore ${index}`,
        excerpt: "excerpt",
        interest: "wildcard",
        score: 50 - index,
      });
    }
    const result = await performGroundedReads(db, "doc", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => new Response(
        `<html><body><p>${"Evidence for a bounded full article read. ".repeat(20)}</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    }, new Date("2026-08-03T12:00:00.000Z"));
    expect(result.readsCreated).toBe(12);
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM cur_reads
       WHERE json_extract(model_metadata_json, '$.selectionLane') = 'interest'`,
    ).get()).toMatchObject({ count: 10 });
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM cur_reads
       WHERE json_extract(model_metadata_json, '$.selectionLane') = 'exploration'`,
    ).get()).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM cognitive_jobs").get())
      .toMatchObject({ count: 0 });
    db.close();
  });

  it("returns the successful ReadRecord values without changing shadow provenance", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const sourceId = upsertSource(db, {
      slug: "returned-read", title: "Returned Read", kind: "rss",
      url: "https://example.com/returned.xml", interest: "systems",
    });
    const itemId = insertItem(db, {
      sourceId,
      url: "https://example.com/returned-article",
      title: "Returned article",
      excerpt: "excerpt",
      interest: "systems",
      score: 90,
    });
    const result = await performGroundedReads(db, "doc", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => new Response(articleHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    }, new Date("2026-08-03T12:00:00.000Z"));

    expect(itemId).not.toBeNull();
    expect(result.reads).toEqual([
      expect.objectContaining({ itemId, title: "Returned article", provenance: "shadow" }),
    ]);
    db.close();
  });

  it("marks a failed selected item skipped so a later tick does not retry it", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const sourceId = upsertSource(db, {
      slug: "no-retry", title: "No Retry", kind: "rss",
      url: "https://example.com/no-retry.xml", interest: "systems",
    });
    const itemId = insertItem(db, {
      sourceId,
      url: "https://example.com/no-retry-article",
      title: "Broken article",
      excerpt: "excerpt",
      interest: "systems",
      score: 90,
    });
    let attempts = 0;
    const options = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => {
        attempts += 1;
        throw new Error("network_down");
      },
    };

    const first = await performGroundedReads(db, "doc", options);
    const second = await performGroundedReads(db, "doc", options);

    expect(first.errors.some((error) => error.includes("network_down"))).toBe(true);
    expect(second.readsCreated).toBe(0);
    expect(attempts).toBe(1);
    expect(db.prepare("SELECT status FROM cur_items WHERE id = ?").get(itemId))
      .toMatchObject({ status: "skipped" });
    db.close();
  });

  afterEach(() => {
    clearCurrentActivity();
  });

  const articleHtml = `<html><body><p>${"Evidence for a bounded full article read. ".repeat(20)}</p></body></html>`;

  it("does not treat fetch as currently reading, even while the request is in flight", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const sourceId = upsertSource(db, {
      slug: "test", title: "Test", kind: "rss",
      url: "https://example.com/feed.xml", interest: "systems",
    });
    insertItem(db, {
      sourceId,
      url: "https://example.com/article",
      title: "The Left Hand of Darkness",
      excerpt: "excerpt",
      interest: "systems",
      score: 90,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = performGroundedReads(db, "doc", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => {
        expect(getCurrentActivity()).toEqual({ state: "none" });
        await gate;
        return new Response(articleHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    });
    release();
    const result = await pending;
    expect(result.readsCreated).toBe(1);
    expect(getCurrentActivity()).toEqual({ state: "none" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM cognitive_jobs").get())
      .toMatchObject({ count: 0 });
    db.close();
  });

  it("never becomes currently reading when fetch fails", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const sourceId = upsertSource(db, {
      slug: "test", title: "Test", kind: "rss",
      url: "https://example.com/feed.xml", interest: "systems",
    });
    insertItem(db, {
      sourceId,
      url: "https://example.com/article",
      title: "Broken fetch",
      excerpt: "excerpt",
      interest: "systems",
      score: 90,
    });
    const seen: Array<ReturnType<typeof getCurrentActivity>> = [];
    const result = await performGroundedReads(db, "doc", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => {
        seen.push(getCurrentActivity());
        throw new Error("network_down");
      },
    });
    expect(result.readsCreated).toBe(0);
    expect(result.errors.some((error) => error.includes("network_down"))).toBe(true);
    expect(seen).toEqual([{ state: "none" }]);
    expect(getCurrentActivity()).toEqual({ state: "none" });
    db.close();
  });

  it("never becomes currently reading when MIME or extraction fails", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const sourceId = upsertSource(db, {
      slug: "test", title: "Test", kind: "rss",
      url: "https://example.com/feed.xml", interest: "systems",
    });
    insertItem(db, {
      sourceId,
      url: "https://example.com/pdf",
      title: "Not HTML",
      excerpt: "excerpt",
      interest: "systems",
      score: 90,
    });
    const result = await performGroundedReads(db, "doc", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => new Response("%PDF-1.4", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    });
    expect(result.readsCreated).toBe(0);
    expect(getCurrentActivity()).toEqual({ state: "none" });
    db.close();
  });
});

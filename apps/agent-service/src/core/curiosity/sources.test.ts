import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { upsertSource } from "./feed.js";

type ScanResult = {
  sourcesFetched: number;
  itemsInserted: number;
  errors: string[];
};

type SourceScanner = (
  db: DatabaseSync,
  dependencies?: {
    fetcher?: typeof fetch;
    resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  },
  now?: Date,
) => Promise<ScanResult>;

async function scanner(): Promise<SourceScanner> {
  const module = await import("./sources.js") as unknown as {
    scanConfiguredSources?: SourceScanner;
  };
  expect(module.scanConfiguredSources).toBeTypeOf("function");
  return module.scanConfiguredSources!;
}

const feed = `<?xml version="1.0"?>
  <rss><channel>
    <item><title>One</title><link>https://example.com/one</link><description>First</description></item>
    <item><title>Two</title><link>https://example.com/two</link><description>Second</description></item>
    <item><title>Three</title><link>https://example.com/three</link><description>Third</description></item>
    <item><title>Four</title><link>https://example.com/four</link><description>Fourth</description></item>
  </channel></rss>`;

const dependencies = {
  resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  fetcher: async () => new Response(feed, {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
  }),
};

describe("configured curiosity source scan", () => {
  it("scans only due RSS or Atom sources and caps each feed at three items", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const due = upsertSource(db, {
        slug: "due-rss",
        title: "Due RSS",
        kind: "rss",
        url: "https://example.com/due.xml",
        interest: "systems",
      });
      const notDue = upsertSource(db, {
        slug: "not-due-atom",
        title: "Not Due Atom",
        kind: "atom",
        url: "https://example.com/not-due.xml",
        interest: "systems",
      });
      upsertSource(db, {
        slug: "json-source",
        title: "JSON Source",
        kind: "json",
        url: "https://example.com/items.json",
        interest: "systems",
      });
      db.prepare("UPDATE cur_sources SET last_fetched_at = ? WHERE id = ?")
        .run("2099-01-01T00:00:00.000Z", notDue);

      const fetched: string[] = [];
      const scan = await (await scanner())(db, {
        ...dependencies,
        fetcher: async (input) => {
          fetched.push(String(input));
          return dependencies.fetcher();
        },
      }, new Date("2026-09-09T00:00:00.000Z"));

      expect(scan).toMatchObject({ sourcesFetched: 1, itemsInserted: 3, errors: [] });
      expect(fetched).toEqual(["https://example.com/due.xml"]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM cur_items").get())
        .toMatchObject({ count: 3 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM cur_items WHERE source_id = ?").get(due))
        .toMatchObject({ count: 3 });
    } finally {
      db.close();
    }
  });

  it("attempts no more than six due configured sources in one scan", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      for (let index = 0; index < 7; index += 1) {
        upsertSource(db, {
          slug: `source-${index}`,
          title: `Source ${index}`,
          kind: "rss",
          url: `https://example.com/source-${index}.xml`,
          interest: "systems",
        });
      }
      let fetches = 0;
      const scan = await (await scanner())(db, {
        ...dependencies,
        fetcher: async () => {
          fetches += 1;
          return dependencies.fetcher();
        },
      }, new Date("2026-09-09T00:00:00.000Z"));

      expect(fetches).toBe(6);
      expect(scan.sourcesFetched).toBe(6);
      expect(db.prepare("SELECT COUNT(*) AS count FROM cur_sources WHERE last_fetched_at IS NOT NULL").get())
        .toMatchObject({ count: 6 });
    } finally {
      db.close();
    }
  });

  it("records a source failure mechanically and does not immediately retry it", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const sourceId = upsertSource(db, {
        slug: "failed-source",
        title: "Failed Source",
        kind: "rss",
        url: "https://example.com/failed.xml",
        interest: "systems",
      });
      let fetches = 0;
      const failing = {
        ...dependencies,
        fetcher: async () => {
          fetches += 1;
          throw new Error("source_down");
        },
      };
      const now = new Date("2026-09-09T00:00:00.000Z");
      const first = await (await scanner())(db, failing, now);
      db.prepare("UPDATE cur_sources SET last_fetched_at = ? WHERE id = ?")
        .run("2099-01-01T00:00:00.000Z", sourceId);
      const second = await (await scanner())(db, failing, now);

      expect(first.errors).toEqual([`source:${sourceId}:source_down`]);
      expect(second).toEqual({ sourcesFetched: 0, itemsInserted: 0, errors: [] });
      expect(fetches).toBe(1);
      expect(db.prepare("SELECT last_error FROM cur_sources WHERE id = ?").get(sourceId))
        .toMatchObject({ last_error: "source_down" });
    } finally {
      db.close();
    }
  });
});

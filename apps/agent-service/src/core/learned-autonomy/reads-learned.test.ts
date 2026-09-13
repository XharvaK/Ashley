import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertItem, upsertSource } from "../curiosity/feed.js";
import { performGroundedReads } from "../curiosity/reads.js";
import { admitAndAccept, c1Assertion, evidence, OWNER_ID } from "./test-fixtures.js";

function seed(db: DatabaseSync, withLearned: boolean): { firstItem: number; matchedItem: number } {
  const sourceId = upsertSource(db, {
    slug: `c3-${withLearned ? "learned" : "control"}`,
    title: "C3 fixture",
    kind: "rss",
    url: `https://example.com/${withLearned ? "learned" : "control"}.xml`,
    interest: "systems",
  });
  const high = insertItem(db, {
    sourceId,
    url: `https://example.com/${withLearned ? "astronomy" : "high"}`,
    title: "Astronomy systems",
    excerpt: "A separate topic.",
    interest: "astronomy",
    score: 100,
  })!;
  const matched = insertItem(db, {
    sourceId,
    url: `https://example.com/${withLearned ? "compiler" : "matched"}`,
    title: "Compiler systems",
    excerpt: "A compiler systems topic.",
    interest: "compilers",
    score: 80,
  })!;
  if (withLearned) {
    const first = c1Assertion(db, { text: "compiler systems", observedAt: "2026-08-01T00:00:00.000Z" });
    const second = c1Assertion(db, { text: "compiler design", observedAt: "2026-08-02T00:00:00.000Z" });
    admitAndAccept(db, [
      evidence(first, "2026-08-01T00:00:00.000Z"),
      evidence(second, "2026-08-02T00:00:00.000Z"),
    ]);
  }
  return { firstItem: high, matchedItem: matched };
}

describe("C3 Curiosity learned-interest ranking", () => {
  it("changes a later ranking only in dark apply and records the learned id", async () => {
    const controlDb = openNuclearDb(new DatabaseSync(":memory:"));
    const learnedDb = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const control = seed(controlDb, false);
      const learned = seed(learnedDb, true);
      const fetcher = async () => new Response(
        `<html><body><p>${"Grounded evidence paragraph for the C3 fixture. ".repeat(12)}</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
      await performGroundedReads(controlDb, OWNER_ID, { fetcher }, new Date("2026-08-03T12:00:00.000Z"));
      await performGroundedReads(learnedDb, OWNER_ID, {
        fetcher,
        learnedAutonomyMode: "dark_apply",
      }, new Date("2026-08-03T12:00:00.000Z"));
      expect(controlDb.prepare("SELECT item_id FROM cur_reads ORDER BY id LIMIT 1").get())
        .toEqual({ item_id: control.firstItem });
      expect(learnedDb.prepare("SELECT item_id FROM cur_reads ORDER BY id LIMIT 1").get())
        .toEqual({ item_id: learned.matchedItem });
      expect(learnedDb.prepare(
        "SELECT choice_kind, learned_id, eligible_input_affected_ranking, agency_made_final_choice FROM learned_choice_receipts",
      ).get()).toMatchObject({
        choice_kind: "curiosity_rank",
        eligible_input_affected_ranking: 1,
        agency_made_final_choice: 0,
      });
    } finally {
      controlDb.close();
      learnedDb.close();
    }
  });
});

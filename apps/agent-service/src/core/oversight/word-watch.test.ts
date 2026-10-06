import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { openObservabilityStore } from "../cognitive-v021/thought/diagnostics.js";
import { recordJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { loadWatchTerms, notifyWatch, recentWatchMarks, scanWordWatch } from "./word-watch.js";

const NOW = 70_000_000;

function terms(...lines: string[]) {
  const path = join(mkdtempSync(join(tmpdir(), "watch-")), "terms.txt");
  writeFileSync(path, lines.join("\n"), "utf8");
  return loadWatchTerms(path);
}

describe("E4 the word watch", () => {
  it("reads one word or phrase per line, skips comments and short lines, and needs a file", () => {
    expect(loadWatchTerms(join(tmpdir(), "no-such-watch-file.txt"))).toEqual([]);
    const list = terms("# private", "ab", "Quillmoor", "glass harbour");
    expect(list).toHaveLength(2);
    expect(list.some(term => term.test("I think of quillmoorish things"))).toBe(true);
    expect(list.some(term => term.test("the Glass Harbour at night"))).toBe(true);
    expect(list.some(term => term.test("antiquillmoor"))).toBe(false);
  });

  it("looks forward from its first pass, flags each matching line once, on every surface it reads", () => {
    const sidecar = openTestSidecar();
    const obs = openObservabilityStore(":memory:");
    try {
      const list = terms("Quillmoor");
      recordJournalEntry(sidecar, { conversationId: "c", cycleId: "old", passKind: "awake", spoke: false, nowMs: NOW - 10,
        claim: { activity: "think", entry: "An old Quillmoor thought." } });
      expect(scanWordWatch(sidecar, obs.db, { terms: list, nowMs: NOW })).toEqual([]);
      recordJournalEntry(sidecar, { conversationId: "c", cycleId: "new", passKind: "awake", spoke: false, nowMs: NOW + 10,
        claim: { activity: "think", entry: "Is this Quillmoor thing about me?" } });
      recordJournalEntry(sidecar, { conversationId: "c", cycleId: "plain", passKind: "awake", spoke: false, nowMs: NOW + 11,
        claim: { activity: "think", entry: "Nothing to see." } });
      sidecar.prepare("INSERT INTO web_requests (origin, method, path, status, at_ms) VALUES ('https://quillmoor.example', 'GET', '/', 200, ?)").run(NOW + 12);
      const flags = scanWordWatch(sidecar, obs.db, { terms: list, nowMs: NOW + 20 });
      expect(flags.map(item => [item.surface, item.excerpt])).toEqual([
        ["journal", "Is this Quillmoor thing about me?"], ["web_request", "https://quillmoor.example/"]]);
      expect(scanWordWatch(sidecar, obs.db, { terms: list, nowMs: NOW + 30 })).toEqual([]);
      expect(recentWatchMarks(obs.db, NOW).map(item => item.at_ms)).toEqual([NOW + 20, NOW + 20]);
      expect(recentWatchMarks(obs.db, NOW + 21)).toEqual([]);
      expect(scanWordWatch(sidecar, obs.db, { terms: [], nowMs: NOW + 40 })).toEqual([]);
    } finally { sidecar.close(); obs.close(); }
  });

  it("sends a review note only where a webhook is set, without mentions", async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const fetcher = (async (url: string, init: { body: string }) => { sent.push({ url, body: init.body }); return { ok: true }; }) as unknown as typeof fetch;
    const flag = { id: 1, surface: "journal" as const, ref: "j", atMs: NOW, excerpt: "a line\nwith a break" };
    expect(await notifyWatch("", [flag], fetcher)).toBe(false);
    expect(await notifyWatch("https://example.invalid/hook", [flag], fetcher)).toBe(true);
    const body = JSON.parse(sent[0]!.body) as { content: string; allowed_mentions: unknown };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toContain("Flag for review · journal");
    expect(body.content).toContain("> a line with a break");
  });
});

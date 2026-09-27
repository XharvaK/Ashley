import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  TAVILY_SEARCH_URL,
  TavilyWebSearchProvider,
} from "./tavily-search-provider.js";

function database(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Tavily WebSearchProvider", () => {
  it("reuses the Tavily request contract and returns attributable bounded snippets", async () => {
    const db = database();
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(TAVILY_SEARCH_URL);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        query: "public task",
        search_depth: "basic",
        max_results: 2,
        include_answer: false,
      });
      return jsonResponse({
        results: [
          { title: "First", url: "https://first.example/result", content: "First public snippet." },
          { title: "Second", url: "https://second.example/result", content: "Second public snippet." },
          { title: "Third", url: "https://third.example/result", content: "Must be bounded out." },
          { title: "HTTP", url: "http://not-accepted.example", content: "Must be rejected." },
          { title: "Empty", url: "https://empty.example", content: "" },
        ],
      });
    });
    try {
      const provider = new TavilyWebSearchProvider(db, {
        apiKey: "test-key",
        fetcher,
        now: () => new Date("2026-09-27T12:00:00.000Z"),
      });

      expect(provider.available).toBe(true);
      const result = await provider.search("public task", { maxResults: 2 });

      expect(result).toMatchObject({
        query: "public task",
        providerName: "tavily",
        capturedAtMs: Date.parse("2026-09-27T12:00:00.000Z"),
        resultSetId: expect.stringMatching(/^tavily:[0-9a-f]{64}$/),
        results: [
          {
            title: "First",
            url: "https://first.example/result",
            snippet: "First public snippet.",
          },
          {
            title: "Second",
            url: "https://second.example/result",
            snippet: "Second public snippet.",
          },
        ],
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("uses the 12-hour result cache before spending another Tavily credit", async () => {
    const db = database();
    const fetcher = vi.fn(async () => jsonResponse({
      results: [{ title: "Cached", url: "https://cached.example", content: "cached snippet" }],
    }));
    try {
      const provider = new TavilyWebSearchProvider(db, {
        apiKey: "test-key",
        fetcher,
        monthlyCredits: 1,
        dailyCredits: 1,
        now: () => new Date("2026-09-27T12:00:00.000Z"),
      });

      const first = await provider.search("same public task");
      const second = await provider.search("same public task");

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(db.prepare("SELECT COUNT(*) AS count FROM kv WHERE key LIKE 'tavily:%'").get())
        .toMatchObject({ count: 3 });
    } finally {
      db.close();
    }
  });

  it("fails closed on missing credentials and on exhausted daily or monthly budget", async () => {
    const missingKeyDb = database();
    const missingKeyFetcher = vi.fn(async () => jsonResponse({ results: [] }));
    try {
      const missingKey = new TavilyWebSearchProvider(missingKeyDb, {
        apiKey: "",
        fetcher: missingKeyFetcher,
      });
      expect(missingKey.available).toBe(false);
      await expect(missingKey.search("public task")).rejects.toThrow("web_search_unavailable");
      expect(missingKeyFetcher).not.toHaveBeenCalled();
    } finally {
      missingKeyDb.close();
    }

    const budgetDb = database();
    const fetcher = vi.fn(async () => jsonResponse({
      results: [{ title: "One", url: "https://one.example", content: "one" }],
    }));
    let now = new Date("2026-09-27T12:00:00.000Z");
    try {
      const provider = new TavilyWebSearchProvider(budgetDb, {
        apiKey: "test-key",
        fetcher,
        monthlyCredits: 1,
        dailyCredits: 1,
        now: () => now,
      });
      await provider.search("first public task");
      await expect(provider.search("second public task")).rejects.toThrow("web_search_quota_exhausted");
      expect(fetcher).toHaveBeenCalledTimes(1);

      now = new Date("2026-09-28T12:00:00.000Z");
      await expect(provider.search("third public task")).rejects.toThrow("web_search_quota_exhausted");
      expect(fetcher).toHaveBeenCalledTimes(1);

      now = new Date("2026-10-01T12:00:00.000Z");
      await expect(provider.search("fourth public task")).resolves.toMatchObject({
        providerName: "tavily",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      budgetDb.close();
    }
  });

  it("does not retain raw provider failures or accept oversized or malformed responses", async () => {
    const oversizedDb = database();
    try {
      const oversized = new TavilyWebSearchProvider(oversizedDb, {
        apiKey: "test-key",
        fetcher: async () => new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(512 * 1024 + 1),
          },
        }),
      });
      await expect(oversized.search("public task")).rejects.toThrow("web_search_response_limit");
    } finally {
      oversizedDb.close();
    }

    const malformedDb = database();
    try {
      const malformed = new TavilyWebSearchProvider(malformedDb, {
        apiKey: "test-key",
        fetcher: async () => new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      });
      await expect(malformed.search("public task")).rejects.toThrow("web_search_provider_response_invalid");
    } finally {
      malformedDb.close();
    }
  });

  it("classifies authentication, rate-limit, upstream, network, and timeout failures", async () => {
    for (const [status, code] of [
      [401, "web_search_provider_auth"],
      [429, "web_search_provider_rate_limited"],
      [503, "web_search_provider_unavailable"],
    ] as const) {
      const db = database();
      try {
        const provider = new TavilyWebSearchProvider(db, {
          apiKey: "test-key",
          fetcher: async () => new Response("{}", { status }),
        });
        await expect(provider.search(`status ${status}`)).rejects.toThrow(code);
      } finally {
        db.close();
      }
    }

    const networkDb = database();
    try {
      const network = new TavilyWebSearchProvider(networkDb, {
        apiKey: "test-key",
        fetcher: async () => { throw new Error("socket closed"); },
      });
      await expect(network.search("network failure")).rejects.toThrow("web_search_network_error");
    } finally {
      networkDb.close();
    }

    const timeoutDb = database();
    try {
      const timeout = new TavilyWebSearchProvider(timeoutDb, {
        apiKey: "test-key",
        timeoutMs: 5,
        fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      });
      await expect(timeout.search("timeout failure")).rejects.toThrow("web_search_timeout");
    } finally {
      timeoutDb.close();
    }
  });
});

describe("Tavily shipping composition", () => {
  it("binds the existing Tavily provider through the current WebSearchProvider seam", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../serve.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("TavilyWebSearchProvider");
    expect(source).toContain("webSearchProvider");
    expect(source).toContain("adapters: { webFetchProvider, webSearchProvider }");
  });
});

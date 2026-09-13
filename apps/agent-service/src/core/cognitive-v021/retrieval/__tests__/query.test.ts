import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeApostrophes,
  normalizeTextForQuery,
  tokenizeForQuery,
  buildFtsQueryString,
  buildRetrievalQuery,
} from "../query.js";
import { openTestSidecar } from "../../test-support.js";

describe("Retrieval Query Formation", () => {
  it("normalizes diverse curly and Unicode apostrophe variants", () => {
    const raw = "let’s talk with ‘single quotes’ and modifierʼs or fullwidth＇s or acute´s or backtick`s";
    const normalized = normalizeApostrophes(raw);
    expect(normalized).toBe(
      "let's talk with 'single quotes' and modifier's or fullwidth's or acute's or backtick's",
    );
  });

  it("rejoins contractions and drops 1-char tokens", () => {
    const text = "I need to sleep soon - let's talk tomorrow, ok?";
    const tokens = tokenizeForQuery(text);

    // 'i', 's', 'to' (if single char, but 'to' has len 2)
    expect(tokens).not.toContain("i");
    expect(tokens).not.toContain("s");
    expect(tokens).toContain("need");
    expect(tokens).toContain("sleep");
    expect(tokens).toContain("soon");
    expect(tokens).toContain("lets");
    expect(tokens).toContain("talk");
    expect(tokens).toContain("tomorrow");
    expect(tokens).toContain("ok");
  });

  it("preserves technical identifiers and acronyms", () => {
    const text = "The HY3 engine on M4 hardware with GPT and LLM API plus Qwen model";
    const tokens = tokenizeForQuery(text);

    expect(tokens).toContain("hy3");
    expect(tokens).toContain("m4");
    expect(tokens).toContain("gpt");
    expect(tokens).toContain("llm");
    expect(tokens).toContain("api");
    expect(tokens).toContain("qwen");
  });

  it("preserves multilingual tokens and diacritics", () => {
    const text = "Test 中文 and こんにちは and Turkish ğüşıöç and café résumé";
    const tokens = tokenizeForQuery(text);

    expect(tokens).toContain("中文");
    expect(tokens).toContain("こんにちは");
    expect(tokens).toContain("ğüşıöç");
    expect(tokens).toContain("café");
    expect(tokens).toContain("résumé");
  });

  it("builds properly escaped FTS5 query string", () => {
    const query = buildFtsQueryString(["need", 'sleep"now', "tomorrow"]);
    expect(query).toBe('"need" OR "sleep""now" OR "tomorrow"');
  });

  it("resolves exactKeys only from non-null concerns.assertion_key", () => {
    const db = openTestSidecar();
    try {
      db.exec(`
        INSERT INTO concerns (concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key, status, snapshot_hash)
        VALUES
          ('c1', 'conv-1', 'Statement 1', '[]', '{"source":"owner_utterance","status":"asserted","time":"current","reliability":"owner_supplied"}', 'mem:pref:sleep', 'active', 'hash1'),
          ('c2', 'conv-1', 'Statement 2', '[]', '{"source":"owner_utterance","status":"asserted","time":"current","reliability":"owner_supplied"}', NULL, 'active', 'hash2');
      `);

      const query = buildRetrievalQuery({
        triggerText: "hello there",
        workingContext: [
          {
            id: "wc-1",
            conversationId: "conv-1",
            type: "topic",
            text: "Discussing sleep schedule",
            concernId: "c1",
            sourceTurnIds: [],
            status: "active",
            supersedesId: null,
            updatedGeneration: 1,
          },
          {
            id: "wc-2",
            conversationId: "conv-1",
            type: "topic",
            text: "Unknown concern item",
            concernId: "c2",
            sourceTurnIds: [],
            status: "active",
            supersedesId: null,
            updatedGeneration: 1,
          },
        ],
        occupancy: [],
        db,
      });

      expect(query.exactKeys).toEqual(["mem:pref:sleep"]);
      expect(query.rawTriggerTerms).toContain("hello");
      expect(query.rawTriggerTerms).toContain("there");
      expect(query.concernTerms).toContain("discussing");
      expect(query.concernTerms).toContain("sleep");
      expect(query.concernTerms).toContain("schedule");
    } finally {
      db.close();
    }
  });

  it("does not suppress common English words with any hardcoded stopword list", () => {
    const text = "The need for sleep and talk about tomorrow with you";
    const tokens = tokenizeForQuery(text);

    // Common words with length >= 2 MUST be preserved for BM25 IDF weighting
    expect(tokens).toContain("the");
    expect(tokens).toContain("need");
    expect(tokens).toContain("for");
    expect(tokens).toContain("sleep");
    expect(tokens).toContain("and");
    expect(tokens).toContain("talk");
    expect(tokens).toContain("about");
    expect(tokens).toContain("tomorrow");
    expect(tokens).toContain("with");
    expect(tokens).toContain("you");
  });

  it("handles empty query cleanly with emptyReason", () => {
    const query = buildRetrievalQuery({
      triggerText: "   ",
      workingContext: [],
      occupancy: [],
    });

    expect(query.exactKeys).toEqual([]);
    expect(query.rawTriggerTerms).toEqual([]);
    expect(query.rawTriggerFtsQuery).toBeNull();
    expect(query.concernTerms).toEqual([]);
    expect(query.concernFtsQuery).toBeNull();
    expect(query.emptyReason).toBe("no_terms_or_exact_keys");
  });
});

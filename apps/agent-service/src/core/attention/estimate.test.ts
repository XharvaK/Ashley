import { describe, expect, it } from "vitest";
import {
  BYTES_PER_TOKEN,
  FRAMING_TOKEN_OVERHEAD,
  IMAGE_TOKEN_RESERVE,
  estimateRequestTokens,
} from "./estimate.js";

describe("conservative token estimator", () => {
  it("estimates ASCII from UTF-8 bytes, not characters/4", () => {
    const content = "a".repeat(100);
    const estimate = estimateRequestTokens([{ role: "user", content }]);
    const bytes = Buffer.byteLength(`user${content}`, "utf8");
    const expected =
      Math.ceil(bytes / BYTES_PER_TOKEN) + FRAMING_TOKEN_OVERHEAD;
    expect(estimate.estimatedInputTokens).toBe(expected);
    expect(estimate.estimatedOutputTokens).toBe(2048);
  });

  it("counts Turkish multi-byte characters by bytes", () => {
    const content = "ğüşıöç".repeat(20);
    const bytes = Buffer.byteLength(`user${content}`, "utf8");
    const estimate = estimateRequestTokens([{ role: "user", content }]);
    expect(estimate.estimatedInputTokens).toBe(
      Math.ceil(bytes / BYTES_PER_TOKEN) + FRAMING_TOKEN_OVERHEAD,
    );
    expect(estimate.estimatedInputTokens).toBeGreaterThan(
      Math.ceil(content.length / 4),
    );
  });

  it("includes code and tools overhead", () => {
    const toolsJson = JSON.stringify({
      tools: [{ function: { name: "search", parameters: { q: "x" } } }],
    });
    const withTools = estimateRequestTokens(
      [{ role: "user", content: "function foo() { return 1; }" }],
      { toolsJson, maxTokens: 100 },
    );
    const without = estimateRequestTokens(
      [{ role: "user", content: "function foo() { return 1; }" }],
      { maxTokens: 100 },
    );
    expect(withTools.estimatedInputTokens).toBeGreaterThan(
      without.estimatedInputTokens,
    );
    expect(withTools.estimatedOutputTokens).toBe(100);
  });

  it("counts provider wire material without duplicating logical messages", () => {
    const withoutSchema = estimateRequestTokens([{ role: "user", content: "x" }]);
    const withSchema = estimateRequestTokens([{ role: "user", content: "x" }], {
      wireAdditionalBytes: 100,
    });

    expect(withSchema.estimatedInputTokens - withoutSchema.estimatedInputTokens)
      .toBe(Math.ceil(100 / BYTES_PER_TOKEN));
  });

  it("reserves conservative tokens per image", () => {
    const estimate = estimateRequestTokens([
      {
        role: "user",
        content: "see",
        imageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
      },
    ]);
    expect(estimate.estimatedInputTokens).toBeGreaterThanOrEqual(
      2 * IMAGE_TOKEN_RESERVE,
    );
  });
});

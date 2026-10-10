import { describe, expect, it } from "vitest";
import { planContentBubbles } from "./bubble-plan.js";
import { DISCORD_CONTENT_LIMIT } from "./types.js";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("planContentBubbles surrogate pairs (A6-15)", () => {
  it("never cuts an emoji pair across two bubbles", () => {
    const text = "a".repeat(DISCORD_CONTENT_LIMIT - 1) + "\u{1F600}" + "b".repeat(10);
    const bubbles = planContentBubbles(text).map((bubble) => bubble.text);

    expect(bubbles).toHaveLength(2);
    for (const bubble of bubbles) expect(bubble).not.toMatch(LONE_SURROGATE);
    expect(bubbles.join("")).toBe(text);
    expect(bubbles[1]!.startsWith("\u{1F600}")).toBe(true);
  });

  it("keeps bubbles within the Discord limit", () => {
    const text = "\u{1F600}".repeat(DISCORD_CONTENT_LIMIT);
    const bubbles = planContentBubbles(text).map((bubble) => bubble.text);
    for (const bubble of bubbles) {
      expect(bubble.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
      expect(bubble).not.toMatch(LONE_SURROGATE);
    }
    expect(bubbles.join("")).toBe(text);
  });
});

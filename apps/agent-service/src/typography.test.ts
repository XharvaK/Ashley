import { describe, expect, it } from "vitest";
import { sanitizeTypography } from "./typography.js";

describe("sanitizeTypography", () => {
  it("turns a mid-sentence em dash into a comma", () => {
    expect(sanitizeTypography("send nothing—but then you handle reactions")).toBe(
      "send nothing, but then you handle reactions",
    );
  });

  it("handles a spaced em dash", () => {
    expect(sanitizeTypography("yeah — no")).toBe("yeah, no");
  });

  it("keeps numeric ranges as hyphens", () => {
    expect(sanitizeTypography("density drops 30–50% in a week")).toBe(
      "density drops 30-50% in a week",
    );
  });

  it("does not double punctuation", () => {
    expect(sanitizeTypography("fine—. whatever")).toBe("fine. whatever");
  });

  it("straightens quotes and ellipses", () => {
    expect(sanitizeTypography("that’s the “thing”…")).toBe(
      "that's the \"thing\"...",
    );
  });

  it("leaves fenced code untouched", () => {
    const input = 'look:\n```ts\nconst s = "a—b";\n```\nthat’s it';
    expect(sanitizeTypography(input)).toBe(
      'look:\n```ts\nconst s = "a—b";\n```\nthat\'s it',
    );
  });

  it("is a no-op on clean text", () => {
    const clean = "no idea, and i'm not going to guess at a dose.";
    expect(sanitizeTypography(clean)).toBe(clean);
  });
});

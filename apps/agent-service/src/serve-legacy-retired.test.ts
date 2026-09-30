import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// R20: the legacy reflection review is retired from the maintenance tick; the
// v0.2.1 afterglow and NIGHT passes own reflection now.
describe("serve maintenance", () => {
  it("does not run the legacy reflection review", () => {
    const source = readFileSync(new URL("./serve.ts", import.meta.url), "utf8");
    expect(source).not.toContain("processPendingOpenCognitiveReviews");
    expect(source).not.toContain("core/reflection/initiative");
  });
});

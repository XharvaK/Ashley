import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

describe("Incident C Synthetic Fixture Format", () => {
  const fixturesDir = fileURLToPath(new URL("..", import.meta.url));

  it("loads synthetic items with required schema", () => {
    const synthFile = join(fixturesDir, "incident-c-synthetic.json");
    expect(existsSync(synthFile)).toBe(true);

    const items = JSON.parse(readFileSync(synthFile, "utf8"));
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(typeof item.assertionKey).toBe("string");
      expect(typeof item.statement).toBe("string");
      expect(typeof item.originalLength).toBe("number");
      expect(typeof item.syntheticLength).toBe("number");
      expect(item.syntheticLength).toBe(item.originalLength);
      expect(item.statement.length).toBeGreaterThan(0);
      expect(typeof item.live).toBe("boolean");
    }
  });

  it("loads labels for all synthetic items", () => {
    const synthFile = join(fixturesDir, "incident-c-synthetic.json");
    const labelsFile = join(fixturesDir, "incident-c-labels.json");

    expect(existsSync(labelsFile)).toBe(true);

    const items = JSON.parse(readFileSync(synthFile, "utf8"));
    const labels = JSON.parse(readFileSync(labelsFile, "utf8"));

    for (const item of items) {
      expect(labels[item.assertionKey]).toBeDefined();
      expect(["relevant", "irrelevant", "weakly_relevant"]).toContain(labels[item.assertionKey]);
    }
  });

  it("loads fidelity report", () => {
    const fidelityFile = join(fixturesDir, "synthetic-fidelity.json");
    expect(existsSync(fidelityFile)).toBe(true);

    const fidelity = JSON.parse(readFileSync(fidelityFile, "utf8"));
    expect(fidelity.matchedCount).toBeGreaterThan(0);
    expect(fidelity.lengthPreserved).toBe(true);
  });
});

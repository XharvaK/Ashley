import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const srcDir = path.join(packageRoot, "src");

function sourceFiles(): string[] {
  return readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(srcDir, name));
}

function sources(): string {
  return sourceFiles()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("sandbox-policy package purity", () => {
  it("has no runtime dependencies and imports no model/provider client", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    const combined = sources();
    for (const forbidden of [
      "@mistralai",
      "groq-sdk",
      "openai",
      "nvidia",
      "nim",
      "@composer-assistant/agent-service",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });

  it("executes no commands", () => {
    const combined = sources();
    for (const forbidden of [
      "child_process",
      "execSync",
      "spawnSync",
      "node:fs",
      "node:net",
      "node:http",
      "node:https",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
  });

  it("reads no environment secrets", () => {
    const combined = sources();
    expect(combined).not.toContain("process.env");
  });

  it("stays deterministic: no clocks, randomness or mutable runtime state", () => {
    const combined = sources();
    expect(combined).not.toContain("Date.now()");
    expect(combined).not.toContain("Math.random");
    expect(combined).not.toContain("randomBytes");
  });
});

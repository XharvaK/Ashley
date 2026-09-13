import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const kernelRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const boundaryTestName = "import-boundary.test.ts";

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith(".ts") && !path.endsWith(boundaryTestName)) files.push(path);
  }
  return files;
}

describe("v0.2.1 Expression import boundary", () => {
  it("keeps legacy conversation Expression cognition out of the new kernel", () => {
    for (const path of sourceFiles(kernelRoot)) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/(?:from\s+|import\s*\()\s*["'][^"']*conversation\/expression\.js["']/);
      expect(source, path).not.toMatch(/\b(?:finalizeHonesty|expressSpeak)\b/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createProductionDataPlane, reservedProductionNuclearDbPath } from "../core/data-plane.js";

describe("agent-service startup termination proof", () => {
  it("terminates with exit code 78 and does not hang when database schema is unsupported, keeping reserved state untouched", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ashley-term-test-"));
    const dataPlane = createProductionDataPlane({ dataDir: tempDir });
    mkdirSync(dataPlane.conversationsDir, { recursive: true });

    // Seed the over-new-schema fixture at the exact path produced by the explicit temporary production data plane
    const initDb = new DatabaseSync(dataPlane.nuclearDbPath);
    initDb.exec("PRAGMA user_version = 999;");
    initDb.close();

    // Defense-in-depth: record reserved production state before test
    const reservedPath = reservedProductionNuclearDbPath();
    const existsBefore = existsSync(reservedPath);
    const mtimeBefore = existsBefore ? statSync(reservedPath).mtimeMs : null;
    const sizeBefore = existsBefore ? statSync(reservedPath).size : null;

    try {
      // Child explicitly invokes runAgentMain({ dataDir: tempDir }) via CLI argument
      const inlineScript = `import { runAgentMain } from "./src/index.js"; void runAgentMain({ dataDir: process.argv[1] });`;
      const proc = spawn(
        process.execPath,
        ["--import", "tsx", "-e", inlineScript, tempDir],
        {
          cwd: join(__dirname, "..", ".."),
        },
      );

      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error("Process timed out (hung with active handles)"));
        }, 15_000);

        proc.on("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

      expect(exitCode).toBe(78);
      expect(stderr).toContain("FATAL [unsupported_nuclear_schema] (exit 78)");

      // Verify reserved production state was untouched
      const existsAfter = existsSync(reservedPath);
      expect(existsAfter).toBe(existsBefore);
      if (existsBefore) {
        const statAfter = statSync(reservedPath);
        expect(statAfter.mtimeMs).toBe(mtimeBefore);
        expect(statAfter.size).toBe(sizeBefore);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

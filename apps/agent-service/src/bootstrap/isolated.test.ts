import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapIsolatedRuntime,
  isolatedDataDirFromArgv,
} from "./isolated.js";
import {
  reservedProductionContinuityDbPath,
  reservedProductionDataDir,
  reservedProductionNuclearDbPath,
} from "../core/data-plane.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep SQLite handles briefly after close.
      }
    }
  }
});

describe("isolated persona-eval bootstrap", () => {
  it("requires an explicit isolated data directory from argv", () => {
    expect(() => isolatedDataDirFromArgv(["node", "isolated-index.js"])).toThrow(
      /isolated_data_dir_required/,
    );
    expect(
      isolatedDataDirFromArgv(["node", "isolated-index.js", "D:\\eval-data"]),
    ).toBe("D:\\eval-data");
  });

  it("activates an isolated plane without touching reserved production stores or .env", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ashley-persona-eval-plane-"));
    temps.push(dataDir);
    writeFileSync(join(dataDir, ".env"), "ASHLEY_ISOLATED_BOOTSTRAP_MARKER=eval-only\n");

    const nuclearBefore = existsSync(reservedProductionNuclearDbPath())
      ? statSync(reservedProductionNuclearDbPath())
      : null;
    const continuityBefore = existsSync(reservedProductionContinuityDbPath())
      ? statSync(reservedProductionContinuityDbPath())
      : null;

    const previousMarker = process.env.ASHLEY_ISOLATED_BOOTSTRAP_MARKER;
    delete process.env.ASHLEY_ISOLATED_BOOTSTRAP_MARKER;
    const manager = bootstrapIsolatedRuntime({ dataDir });
    try {
      expect(manager.dataPlane.kind).toBe("isolated");
      expect(manager.dataPlane.dataDir).toBe(dataDir);
      expect(manager.dataPlane.envPath).toBe(join(dataDir, ".env"));
      expect(manager.dataPlane.envPath).not.toBe(
        join(reservedProductionDataDir(), ".env"),
      );
      expect(manager.dataPlane.nuclearDbPath.startsWith(dataDir)).toBe(true);
      expect(manager.dataPlane.continuityDbPath.startsWith(dataDir)).toBe(true);
      expect(process.env.ASHLEY_ISOLATED_BOOTSTRAP_MARKER).toBe("eval-only");
    } finally {
      manager.logger.close();
      manager.core.getDatabase().close();
      if (previousMarker === undefined) {
        delete process.env.ASHLEY_ISOLATED_BOOTSTRAP_MARKER;
      } else {
        process.env.ASHLEY_ISOLATED_BOOTSTRAP_MARKER = previousMarker;
      }
    }

    const nuclearAfter = existsSync(reservedProductionNuclearDbPath())
      ? statSync(reservedProductionNuclearDbPath())
      : null;
    const continuityAfter = existsSync(reservedProductionContinuityDbPath())
      ? statSync(reservedProductionContinuityDbPath())
      : null;
    expect(nuclearAfter?.mtimeMs ?? null).toBe(nuclearBefore?.mtimeMs ?? null);
    expect(continuityAfter?.mtimeMs ?? null).toBe(continuityBefore?.mtimeMs ?? null);
  });

  it("uses the isolated entrypoint and does not restore COMPOSER_DATA_DIR", () => {
    const isolatedIndex = readFileSync(
      new URL("../isolated-index.ts", import.meta.url),
      "utf8",
    );
    const launcher = readFileSync(
      new URL("../../../../scripts/persona-eval/run-isolated.ps1", import.meta.url),
      "utf8",
    );
    expect(isolatedIndex).toContain("bootstrapIsolatedRuntime");
    expect(isolatedIndex).not.toContain("bootstrapProductionRuntime");
    expect(launcher).toContain("isolated-index.js");
    expect(launcher).not.toContain("COMPOSER_DATA_DIR");
    expect(launcher).not.toContain("dist\\index.js");
    expect(launcher).toContain(".composer-assistant-persona-eval");
  });
});

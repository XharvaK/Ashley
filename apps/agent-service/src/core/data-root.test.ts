import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reservedProductionDataDir } from "./data-plane.js";

const previous = process.env.ASHLEY_DATA_DIR;
const defaultRoot = resolve(join(homedir(), ".composer-assistant"));

describe("reservedProductionDataDir", () => {
  afterEach(() => {
    if (previous === undefined) delete process.env.ASHLEY_DATA_DIR;
    else process.env.ASHLEY_DATA_DIR = previous;
  });

  it("uses the home default when unset", () => {
    delete process.env.ASHLEY_DATA_DIR;
    expect(reservedProductionDataDir()).toBe(defaultRoot);
  });

  it("resolves a configured directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-data-root-"));
    try {
      process.env.ASHLEY_DATA_DIR = join(dir, "nested", "..", "configured");
      expect(reservedProductionDataDir()).toBe(resolve(process.env.ASHLEY_DATA_DIR));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a blank string as the default", () => {
    process.env.ASHLEY_DATA_DIR = "";
    expect(reservedProductionDataDir()).toBe(defaultRoot);
  });
});

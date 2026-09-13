import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "./db.js";
import { AshleyCore } from "./runtime.js";
import { openContinuityDb } from "./continuity/db.js";

describe("wave10c health contract", () => {
  it("keeps detailed diagnostics owner-surface metadata-only", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const core = new AshleyCore(nuclear);
    const health = core.getHealthSnapshot({
      ready: false,
      providerState: "unavailable",
    });

    expect(health).toMatchObject({
      liveness: true,
      ready: false,
      provider: "unavailable",
      db: {
        schemaVersion: NUCLEAR_SUPPORTED_VERSION,
        integrity: "ok",
        foreignKeys: "enabled",
        continuity: {
          available: true,
          schemaVersion: 1,
          lineagePresent: true,
        },
      },
    });
    expect(health.deliveryPressure).toBeDefined();
    expect(health.backgroundStarvation).toBeDefined();
    expect(health.backup).toMatchObject({ available: false });
    expect(health.identity.resolvedModels.every((row) =>
      row.alias.length > 0 && !("prompt" in row) && !("payload" in row),
    )).toBe(true);
    expect(JSON.stringify(health)).not.toContain("nuclear.db");
    expect(JSON.stringify(health)).not.toContain("continuity.db");

    nuclear.close();
    continuity.close();
  });
});

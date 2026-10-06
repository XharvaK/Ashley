import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V35 migration", () => {
  it("creates durable Owner Discord transport capture and cursor tables", () => {
    const db = openTestSidecar();
    setTestSidecarVersion(db, 34);

    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

    expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(68);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(68);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("owner_discord_transport_captures")).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("owner_discord_transport_cursors")).toBeTruthy();
  });
});

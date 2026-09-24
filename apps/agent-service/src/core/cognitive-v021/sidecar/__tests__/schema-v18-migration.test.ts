import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

describe("cognitive sidecar Schema V18 migration", () => {
  it("adds watch claim and ingestion frontier columns and is idempotent", () => {
    const db = openTestSidecar();
    try {
      db.exec("PRAGMA user_version = 17");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 17 WHERE id = 1").run();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(25);
      expect(db.prepare("PRAGMA table_info(observation_subscriptions)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "poll_claim_token" }),
        expect.objectContaining({ name: "poll_claim_expires_at_ms" }),
        expect.objectContaining({ name: "poll_generation" }),
        expect.objectContaining({ name: "ingested_frontier_at_ms" }),
      ]));

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});

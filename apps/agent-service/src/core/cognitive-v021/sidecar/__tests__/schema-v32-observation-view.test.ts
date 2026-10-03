import { describe, expect, it } from "vitest";
import { getCanonicalObservationById } from "../../observation/persistence.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";

describe("cognitive sidecar Schema V32 observation views", () => {
  it("adds nullable view identity columns and preserves legacy observation payloads", () => {
    const db = openTestSidecar();
    try {
      setTestSidecarVersion(db, 31);
      db.prepare(
        `INSERT INTO observations
           (observation_id, cycle_id, generation, derived, replay_safe, modality, payload_json,
            provenance, raw_outranks_derived_of, data_classification, secret_omitted, created_at_ms)
         VALUES (?, ?, ?, 0, 1, 'tool', ?, ?, NULL, 'never_public', 0, ?)`
      ).run("observation:legacy-v31", "cycle:legacy-v31", 1, "{\"content\":\"legacy\"}", "test:legacy", 10);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      const columns = (db.prepare("PRAGMA table_info(observations)").all() as Array<{ name: string }>).map((row) => row.name);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(59);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 58 });
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get())
        .toMatchObject({ schema_version: 58 });
      expect(columns).toEqual(expect.arrayContaining([
        "parent_artifact_id",
        "representation_id",
        "view_metadata_json",
      ]));
      expect(db.prepare(
        "SELECT parent_artifact_id, representation_id, view_metadata_json, payload_json FROM observations WHERE observation_id = ?",
      ).get("observation:legacy-v31")).toEqual({
        parent_artifact_id: null,
        representation_id: null,
        view_metadata_json: null,
        payload_json: "{\"content\":\"legacy\"}",
      });
      expect(getCanonicalObservationById(db, "observation:legacy-v31")).not.toHaveProperty("view");
    } finally {
      db.close();
    }
  });
});

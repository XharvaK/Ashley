import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { listPersonaSnapshots, personaChanges, PERSONA_SNAPSHOT_INTERVAL_MS, takePersonaSnapshotIfDue } from "./snapshots.js";
import { applyV021Forget } from "../memory/forget.js";

const T0 = Date.UTC(2026, 9, 1, 12, 0);

describe("A8 weekly persona snapshot", () => {
  it("takes one snapshot a week and reports what changed between them", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const identity = { nuclear, ownerId: "doc" };
      expect(takePersonaSnapshotIfDue(sidecar, identity, T0)).not.toBeNull();
      // Not again within the week.
      expect(takePersonaSnapshotIfDue(sidecar, identity, T0 + 60_000)).toBeNull();

      sidecar.prepare(
        `INSERT INTO growth_revisions (layer, topic, target_key, proposed_text, rationale, status, proposed_cycle_id, data_classification, created_at_ms, updated_at_ms, applied_at_ms)
         VALUES ('opinion', 'jazz', 'opinion:jazz', 'Late Coltrane is worth the effort.', 'r', 'applied', 'cycle-jazz', 'ordinary', ?, ?, ?)`,
      ).run(T0 + 1, T0 + 1, T0 + 1);
      expect(takePersonaSnapshotIfDue(sidecar, identity, T0 + PERSONA_SNAPSHOT_INTERVAL_MS)).not.toBeNull();

      const snapshots = listPersonaSnapshots(sidecar);
      expect(snapshots).toHaveLength(2);
      expect(personaChanges(snapshots)).toEqual([expect.objectContaining({
        fromMs: T0,
        toMs: T0 + PERSONA_SNAPSHOT_INTERVAL_MS,
        opinionsChanged: ["jazz"],
        identityAdded: [],
        identityRemoved: [],
        narrativeChanged: false,
      })]);
      // A forget reaches the witness too: the snapshot that named it loses its words.
      applyV021Forget(sidecar, { topic: "Coltrane", nowMs: T0 + PERSONA_SNAPSHOT_INTERVAL_MS + 1 });
      expect(JSON.stringify(listPersonaSnapshots(sidecar))).not.toContain("Coltrane");
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});

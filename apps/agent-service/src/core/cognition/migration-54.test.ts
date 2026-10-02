import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { restoreLegacyV53Objects } from "./__tests__/fixtures/legacy-v53.js";
import { getContinuityFor } from "../continuity/registry.js";
import { createEpisode } from "../memory/episodes.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";

const dropped = ["identity_reviews", "learning_revisions", "context_budget_policies", "context_allocation_receipts", "context_summary_projections"];
function assertV54(db: DatabaseSync, version: 54 | 56 = 54): void {
  expect(NUCLEAR_SUPPORTED_VERSION).toBe(56);
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: version });
  for (const name of dropped) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toBeUndefined();
  for (const name of ["evidence_links", ...(version === 54 ? ["cognitive_maturation_contract_state"] : ["relationship_contract_state"])]) expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)).toEqual({ name });
  expect(db.prepare("PRAGMA foreign_key_list(lived_experience_links)").all()).not.toEqual(expect.arrayContaining([expect.objectContaining({ table: "learning_revisions" })]));
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
}

describe("nuclear migration 54 legacy removal", () => {
  it("passes migration 54 in a fresh database while preserving the kept organs", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try { assertV54(db, 56); } finally { db.close(); }
  });

  it("upgrades v53, preserves lived experience rows and columns, and removes only the revision FK", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      restoreLegacyV53Objects(db);
      db.exec("PRAGMA user_version = 53");
      getContinuityFor(db)!.exec("UPDATE lineage_state SET nuclear_schema_version = 53 WHERE id = 1");
      const threadId = resolveActiveThread(db, "a2-owner");
      const messageId = insertMessage(db, { threadId, ownerId: "a2-owner", role: "user", text: "A lived experience." });
      const episode = createEpisode(db, { threadId, ownerId: "a2-owner", summary: "A lived experience.", messageIds: [messageId] })!;
      db.prepare(`INSERT INTO lived_experience_links
        (id,owner_id,episode_id,operational_ref,revision_id,data_classification,provenance,evidence_refs_json,created_at)
        VALUES ('a2-link','a2-owner',?,'fixture',NULL,'ordinary','shadow','[]',?)`).run(episode.id, new Date().toISOString());
      const before = db.prepare("SELECT * FROM lived_experience_links").all();
      const columns = db.prepare("PRAGMA table_info(lived_experience_links)").all();
      const foreignKeys = db.prepare("PRAGMA foreign_key_list(lived_experience_links)").all().filter((row) => row.table !== "learning_revisions");
      db.prepare(`INSERT INTO evidence_links (owner_id,target_type,target_id,source_type,source_id,created_at)
        VALUES ('a2-owner','fact','kept','episode',?,'fixture')`).run(String(episode.id));
      const evidence = db.prepare("SELECT * FROM evidence_links").all();
      const kept = db.prepare("SELECT * FROM cognitive_maturation_contract_state ORDER BY wave").all();
      expect(before).toHaveLength(1);
      // V54 must preserve this row; the following V55 migration correctly refuses it.
      expect(() => openNuclearDb(db)).toThrow("c4_rows_present:lived_experience_links:1");
      assertV54(db);
      expect(db.prepare("SELECT * FROM lived_experience_links").all()).toEqual(before);
      expect(db.prepare("PRAGMA table_info(lived_experience_links)").all()).toEqual(columns);
      expect(db.prepare("PRAGMA foreign_key_list(lived_experience_links)").all().map(({id, ...row}) => row))
        .toEqual(foreignKeys.map(({id, ...row}) => row));
      expect(db.prepare("SELECT * FROM cognitive_maturation_contract_state ORDER BY wave").all()).toEqual(kept);
      expect(db.prepare("SELECT * FROM evidence_links").all()).toEqual(evidence);
      // Child DML remains possible after its old parent is gone.
      db.prepare("UPDATE lived_experience_links SET operational_ref = 'after' WHERE id='a2-link'").run();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
});

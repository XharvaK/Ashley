import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { TARGETABLE_TABLES } from "../continuity/nuclear-targetable.js";

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (
      db.prepare("PRAGMA user_version").get() as {
        user_version?: number;
      }
    ).user_version ?? 0,
  );
}

function columns(db: DatabaseSync, table: string): string[] {
  return (
    db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

describe("nuclear schema v23/v24 open cognitive items", () => {
  it("creates bounded OCI, attention, and transition tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));

    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master " +
            "WHERE type = 'table' " +
            "AND name IN (" +
            "'open_cognitive_items', " +
            "'open_cognitive_item_attention', " +
            "'open_cognitive_item_transitions'" +
            ") ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(tables).toEqual([
      "open_cognitive_item_attention",
      "open_cognitive_item_transitions",
      "open_cognitive_items",
    ]);
    expect(columns(db, "open_cognitive_items")).toEqual(
      expect.arrayContaining([
        "id",
        "owner_id",
        "entity_uuid",
        "kind",
        "status",
        "semantic_summary",
        "source_type",
        "source_id",
        "source_entity_uuid",
        "semantic_key_hash",
        "source_capability",
        "contract_id",
        "provenance",
        "source_revision",
        "build_identity",
        "model_epoch",
        "model_identity",
        "status_reason",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns(db, "open_cognitive_item_attention")).toEqual(
      expect.arrayContaining([
        "item_id",
        "delay_class",
        "defer_until",
        "consideration_count",
        "review_requested_at",
        "updated_at",
      ]),
    );
    expect(columns(db, "open_cognitive_item_transitions")).toEqual(
      expect.arrayContaining([
        "id",
        "item_id",
        "owner_id",
        "from_status",
        "to_status",
        "reason",
        "created_at",
      ]),
    );

    const forbidden = new Set(columns(db, "open_cognitive_items"));
    expect(forbidden.has("source_text")).toBe(false);
    expect(forbidden.has("raw_reasoning")).toBe(false);
    expect(forbidden.has("prompt_fragment")).toBe(false);
    expect(forbidden.has("chain_of_thought")).toBe(false);

    db.close();
  });

  it("registers OCI rows for continuity targeting", () => {
    expect(TARGETABLE_TABLES).toContainEqual({
      table: "open_cognitive_items",
      idColumn: "id",
      ownerColumn: "owner_id",
      needsClassification: true,
    });
  });
});

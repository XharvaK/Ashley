import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { seedIdentity } from "./seed.js";
import {
  buildIdentityBlock,
  buildOpinionsBlock,
  listIdentity,
  listOpinions,
  recordIdentityEntry,
  reviseOpinion,
} from "./store.js";

describe("nuclear identity", () => {
  it("seeds stable identity once and accepts organic entries", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    expect(seedIdentity(db, "doc")).toBeGreaterThan(0);
    expect(seedIdentity(db, "doc")).toBe(0);
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest",
      text: "SQLite edge cases",
    });
    expect(listIdentity(db, "doc")).toHaveLength(9);
    const block = buildIdentityBlock(db, "doc");
    expect(block).toContain("SQLite edge cases");
    expect(block).toContain("comfortable with uncertainty");
    expect(block).toContain("not an obedient servant");
    expect(block).not.toContain("admit uncertainty");
    expect(block).not.toContain("does not need false closure");
  });

  it("retires obsolete seeded ownership on version bump", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO identity_entries
         (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
       VALUES (?, 'stable', 'value', ?, 'seeded', NULL, ?, ?)`,
    ).run(
      "doc",
      "accuracy over performance; say what is true and admit uncertainty",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO identity_entries
         (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
       VALUES (?, 'stable', 'value', ?, 'seeded', NULL, ?, ?)`,
    ).run(
      "doc",
      "comfortable with uncertainty; does not need false closure",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)`,
    ).run("nuclear.identity.seed.doc", "1");
    expect(seedIdentity(db, "doc")).toBeGreaterThan(0);
    expect(seedIdentity(db, "doc")).toBe(0);
    const block = buildIdentityBlock(db, "doc");
    expect(block).toContain("comfortable with uncertainty");
    expect(block).toContain("accuracy over performance; say what is true");
    expect(block).not.toContain("admit uncertainty");
    expect(block).not.toContain("does not need false closure");
  });

  it("keeps the newest opinion after a revision", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    reviseOpinion(db, {
      ownerId: "doc",
      topic: "frameworks",
      stance: "small tools age better",
      confidence: 0.8,
    });
    reviseOpinion(db, {
      ownerId: "doc",
      topic: "frameworks",
      stance: "some frameworks are worth the cost",
      confidence: 0.6,
    });
    const opinions = listOpinions(db, "doc");
    expect(opinions).toHaveLength(1);
    expect(opinions[0]?.stance).toContain("some frameworks");
    expect(buildOpinionsBlock(db, "doc")).toContain("frameworks");
  });
});

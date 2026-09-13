import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "./db.js";
import { DECLARED_CONTRACT_ID } from "../attention/contract-material.js";
import { capabilityCanInfluence, listCapabilityStatuses } from "../rollout/capabilities.js";
import { TARGETABLE_TABLES } from "./nuclear-targetable.js";

describe("wave05 migration", () => {
  it("migrates through v14 relationship tables to current schema with continuity", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    const version = (
      nuclear.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    expect(version).toBe(NUCLEAR_SUPPORTED_VERSION);
    const sidecarVersion = continuity
      .prepare(`SELECT nuclear_schema_version FROM lineage_state WHERE id = 1`)
      .get() as { nuclear_schema_version?: number };
    expect(sidecarVersion.nuclear_schema_version).toBe(NUCLEAR_SUPPORTED_VERSION);
    for (const table of [
      "doc_reminders",
      "ashley_self_commitments",
      "mutual_commitments",
      "scheduled_proactive_messages",
      "relational_tensions",
      "withdrawal_records",
      "relationship_motivation_claims",
    ]) {
      expect(
        nuclear
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(table),
      ).toBeTruthy();
    }
    nuclear.close();
    continuity.close();
  });

  it("is idempotent on remigrate", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    openNuclearDb(nuclear, { continuity });
    expect(
      (nuclear.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(NUCLEAR_SUPPORTED_VERSION);
    nuclear.close();
    continuity.close();
  });

  it("seeds relationship_state observe on v3 contract", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const row = listCapabilityStatuses(nuclear, "apply").find(
      (item) => item.capability === "relationship_state",
    );
    expect(row).toMatchObject({
      capability: "relationship_state",
      state: "observe",
      contractId: DECLARED_CONTRACT_ID,
    });
    expect(capabilityCanInfluence(nuclear, "relationship_state")).toBe(false);
    nuclear.close();
    continuity.close();
  });

  it("includes relationship tables in targetable registry", () => {
    const names = TARGETABLE_TABLES.map((row) => row.table);
    expect(names).toContain("doc_reminders");
    expect(names).toContain("relationship_motivation_claims");
  });
});

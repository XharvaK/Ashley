import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareDrillCounts, DRILL_TABLES, emptyBackupStatus, readBackupStatus, writeBackupStatusAtomic } from "./backup-lib.js";
import { runBackupDrill } from "./backup-drill.js";

describe("drill comparator", () => {
  it("uses the amended five content tables and append-only flags", () => {
    expect(DRILL_TABLES).toEqual([
      { db: "nuclear", table: "mem_messages", appendOnly: false },
      { db: "nuclear", table: "mem_facts", appendOnly: false },
      { db: "continuity", table: "continuity_events", appendOnly: true },
      { db: "sidecar", table: "conversation_evidence_log", appendOnly: true },
      { db: "sidecar", table: "diary_entries", appendOnly: false },
    ]);
  });

  it("notes restored counts above live without failing, including live zero", () => {
    for (const appendOnly of [false, true]) {
      for (const live of [0, 4]) {
        expect(compareDrillCounts([{ table: "mem_facts", restored: 5, live, appendOnly }]))
          .toEqual({ ok: true, notes: ["drill_count_exceeds_live:mem_facts"] });
      }
    }
  });

  it("fails when live content is nonempty but restored content is empty", () => {
    for (const appendOnly of [false, true]) {
      expect(compareDrillCounts([{ table: "diary_entries", restored: 0, live: 4, appendOnly }]))
        .toEqual({ ok: false, error: "drill_count_empty:diary_entries" });
    }
  });

  it.each(["continuity_events", "conversation_evidence_log"])("fails below 90%% for append-only %s and accepts the boundary", (table) => {
    const spec = DRILL_TABLES.find((entry) => entry.table === table);
    expect(spec).toBeDefined();
    const counts = { table, appendOnly: spec!.appendOnly, live: 100 };
    expect(compareDrillCounts([{ ...counts, restored: 89 }]))
      .toEqual({ ok: false, error: `drill_count_below_tolerance:${table}` });
    expect(compareDrillCounts([{ ...counts, restored: 90 }])).toEqual({ ok: true, notes: [] });
  });

  it("allows nonempty mutable content below 90%, and empty live/restored tables", () => {
    expect(compareDrillCounts([
      { table: "mem_messages", restored: 1, live: 100, appendOnly: false },
      { table: "continuity_events", restored: 0, live: 0, appendOnly: true },
    ])).toEqual({ ok: true, notes: [] });
  });
});

it("records drill_error after corrupt-package verification throws, preserving the last success", () => {
  const dir = mkdtempSync(join(tmpdir(), "ashley-drill-error-"));
  try {
    const pkgDir = join(dir, "backups", "pkg");
    const statusPath = join(dir, "backups", "status.json");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "20261002T050000Z.ashleybak"), "corrupt");
    writeBackupStatusAtomic(statusPath, { ...emptyBackupStatus(), drill_ok_ms: 123 });
    expect(runBackupDrill({ dataDir: dir, loadEnv: false,
      env: { ASHLEY_BACKUP_TRANSFER_KEY: "ab".repeat(32) }, log: () => {} })).toBe(1);
    expect(readBackupStatus(statusPath)).toMatchObject({ drill_ok_ms: 123, drill_error: "drill_failed" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

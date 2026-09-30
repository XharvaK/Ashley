import { describe, expect, it } from "vitest";
import { compareDrillCounts, type DrillCountRow } from "./backup-lib.js";

function row(partial: Partial<DrillCountRow> & Pick<DrillCountRow, "table" | "restored" | "live">): DrillCountRow {
  return { appendOnly: false, ...partial };
}

describe("drill comparator", () => {
  it("requires restored counts at or below live, and at least 90% on append-only tables", () => {
    const ok: DrillCountRow[] = [
      row({ table: "mem_messages", restored: 90, live: 100, appendOnly: true }),
      row({ table: "mem_facts", restored: 100, live: 100, appendOnly: true }),
      row({ table: "continuity_events", restored: 9, live: 10, appendOnly: true }),
      row({ table: "kv", restored: 1, live: 4, appendOnly: false }),
      row({ table: "cognitive_sidecar_meta", restored: 1, live: 1, appendOnly: false }),
    ];
    expect(compareDrillCounts(ok)).toEqual({ ok: true });

    expect(compareDrillCounts([
      row({ table: "mem_messages", restored: 89, live: 100, appendOnly: true }),
    ])).toEqual({ ok: false, error: "drill_count_below_tolerance:mem_messages" });

    expect(compareDrillCounts([
      row({ table: "kv", restored: 5, live: 4, appendOnly: false }),
    ])).toEqual({ ok: false, error: "drill_count_exceeds_live:kv" });

    expect(compareDrillCounts([
      row({ table: "mem_facts", restored: 0, live: 0, appendOnly: true }),
    ])).toEqual({ ok: true });
  });
});

// Gate history records due evaluations without changing NIGHT admission.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import * as afterglow from "./afterglow.js";
import * as inbox from "../cycle/inbox.js";
import * as budget from "../private-budget/ledger.js";
import * as wake from "../wake/ledger.js";
import { readNightState, tickNight } from "./night.js";

const START = Date.UTC(2026, 9, 1, 0, 30);
const DUE = Date.UTC(2026, 9, 1, 1);
function tick(db: DatabaseSync, nowMs: number) {
  return tickNight(db, { conversationId: "receipt", occupantId: "doc", authorityEpoch: 1,
    timeZone: "Etc/GMT-3", nowMs, thought: () => ({ published: true }) });
}
function receipts(db: DatabaseSync): Record<string, unknown>[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='night_gate_receipts'").get()) return [];
  return db.prepare("SELECT * FROM night_gate_receipts ORDER BY rowid").all();
}
afterEach(() => vi.restoreAllMocks());

describe("P7a due NIGHT gate receipts", () => {
  it("migrates without inventing historical gate receipts or changing the rhythm", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START);
      const before = readNightState(db, "receipt");
      setTestSidecarVersion(db, 53);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='night_gate_receipts'").get())
        .toEqual({ name: "night_gate_receipts" });
      expect(receipts(db)).toEqual([]);
      expect(readNightState(db, "receipt")).toEqual(before);
    } finally { db.close(); }
  });
  it("records each blocked due evaluation once, even at the same timestamp", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START);
      await tick(db, DUE - 1);
      expect(receipts(db)).toEqual([]);
      appendOwnerUtterance(db, { conversationId: "receipt", text: "still awake", nowMs: DUE - 1, audienceAtCapture: "owner_private" });
      expect(await tick(db, DUE)).toMatchObject({ outcome: "engaged" });
      expect(await tick(db, DUE)).toMatchObject({ outcome: "engaged" });
      const rows = receipts(db);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map(row => row.evaluation_id)).size).toBe(2);
      for (const row of rows) expect(row).toMatchObject({ conversation_id: "receipt", due_at_ms: DUE, evaluated_at_ms: DUE, gate_code: "engaged" });
      expect(readNightState(db, "receipt")?.nextNightAtMs).toBe(DUE);
    } finally { db.close(); }
  });
  for (const gate of ["afterglow_first", "busy", "in_flight", "budget", "wake_closed", "ran"] as const) {
    it(`records the ${gate} outcome without replacing it`, async () => {
      const db = openTestSidecar(); try {
        await tick(db, START);
        if (gate === "afterglow_first") {
          appendOwnerUtterance(db, { conversationId: "receipt", text: "yesterday", nowMs: START - 3600000, audienceAtCapture: "owner_private" });
        } else if (gate === "busy") {
          vi.spyOn(inbox, "getCurrentCycle").mockReturnValue({ cycleId: "busy" } as ReturnType<typeof inbox.getCurrentCycle>);
        } else if (gate === "in_flight") {
          await tick(db, DUE);
          db.prepare("UPDATE cycle_records SET state='idle' WHERE conversation_id='receipt'").run();
          db.prepare("UPDATE night_state SET next_night_at_ms=? WHERE conversation_id='receipt'").run(DUE);
        } else if (gate === "budget") {
          const original = budget.getPrivateBudgetProjection;
          vi.spyOn(budget, "getPrivateBudgetProjection").mockImplementation((db, input) => ({ ...original(db, input), remaining: 0 }));
        } else if (gate === "wake_closed") {
          vi.spyOn(wake, "admitWake").mockReturnValue({ kind: "stale" } as ReturnType<typeof wake.admitWake>);
        }
        const before = receipts(db).length;
        expect(await tick(db, DUE)).toMatchObject({ outcome: gate });
        expect(receipts(db).slice(before)).toHaveLength(1);
        expect(receipts(db).at(-1)).toMatchObject({ due_at_ms: DUE, evaluated_at_ms: DUE, gate_code: gate });
      } finally { db.close(); }
    });
  }
  it("records a fixed error code and rethrows the original exception", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START);
      const error = new Error("private diagnostic detail");
      vi.spyOn(afterglow, "evaluateAfterglow").mockImplementation(() => { throw error; });
      await expect(tick(db, DUE)).rejects.toBe(error);
      expect(receipts(db)).toHaveLength(1);
      expect(receipts(db)[0]).toMatchObject({ due_at_ms: DUE, evaluated_at_ms: DUE, gate_code: "error" });
      expect(JSON.stringify(receipts(db))).not.toContain(error.message);
      expect(readNightState(db, "receipt")?.nextNightAtMs).toBe(DUE);
    } finally { db.close(); }
  });
  it("records the late budget refusal after admission once", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START);
      vi.spyOn(budget, "reservePrivateThought").mockReturnValue({ kind: "refused" } as ReturnType<typeof budget.reservePrivateThought>);
      expect(await tick(db, DUE)).toMatchObject({ outcome: "budget" });
      expect(receipts(db)).toHaveLength(1);
      expect(receipts(db)[0]?.gate_code).toBe("budget");
      expect(readNightState(db, "receipt")).toMatchObject({ slot: 1, lastOutcome: "budget" });
    } finally { db.close(); }
  });
  it("keeps existing receipts on reopen and rejects duplicate evaluation identities", async () => {
    const db = openTestSidecar(); try {
      await tick(db, START);
      await tick(db, DUE);
      const before = receipts(db);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(receipts(db)).toEqual(before);
      expect(() => db.prepare("INSERT INTO night_gate_receipts VALUES (?, 'other', 0, 0, 'ran')").run(String(before[0]?.evaluation_id))).toThrow();
      expect(() => db.prepare("INSERT INTO night_gate_receipts VALUES ('unknown', 'other', 0, 0, 'invented')").run()).toThrow();
      expect(receipts(db)).toEqual(before);
    } finally { db.close(); }
  });
});

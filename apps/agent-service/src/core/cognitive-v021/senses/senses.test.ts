// A sense states the truth at proportionate volume and then stops; a reasoned no quiets it.
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { recordFriction } from "../growth/friction.js";
import { recordExpectations } from "../growth/expectations.js";
const T = 1000000000;
const DAY = 86400000;
async function api() {
  expect(existsSync(new URL("./senses.ts", import.meta.url)), "senses module exists").toBe(true);
  return import("./senses.js");
}
describe("A3c senses", () => {
  it("crosses fixed bands at boundaries", async () => {
    const { senseBand } = await api();
    expect([0, 1, 3, 10].map(n => senseBand("friction", n))).toEqual(["none", "low", "moderate", "high"]);
    expect([0, 1, 3].map(n => senseBand("expectations", n))).toEqual(["none", "few", "many"]);
    expect([0, 1, 3].map(n => senseBand("stale_concerns", n))).toEqual(["none", "few", "many"]);
    expect([0, 1, 5].map(n => senseBand("delivery_backlog", n))).toEqual(["clear", "pending", "backlogged"]);
    expect([0, 1, 2].map(n => senseBand("private_budget", n))).toEqual(["empty", "low", "available"]);
    expect([0, DAY, 3*DAY, null].map(n => senseBand("backup", n))).toEqual(["fresh", "aging", "stale", "unknown"]);
  });
  it.each(["band", "time"])("a decline hides then re-raises once on %s", async mode => {
    const { sensesForThought, recordSenseDeclines } = await api(); const db = openTestSidecar();
    try {
      const options = { nowMs: T, conversationId: "t" };
      recordSenseDeclines(db, { decline: [{ sense: "friction", rationale: "I have considered it" }] }, options);
      expect(sensesForThought(db, options).lines.some(line => line.startsWith("friction:"))).toBe(false);
      if (mode === "band") recordFriction(db, { kind: "self_reported", nowMs: T+1, note: "NOTE_SECRET", dataClassification: "ordinary" });
      const later = { ...options, nowMs: mode === "time" ? T+7*DAY : T+1 };
      const raised = sensesForThought(db, later).lines.find(line => line.startsWith("friction:"));
      expect(raised).toContain("still declining?");
      expect(sensesForThought(db, later).lines.some(line => line.startsWith("friction:"))).toBe(false);
    } finally { db.close(); }
  });
  it("bounds the block and never includes fixture content", async () => {
    const { sensesForThought } = await api(); const db = openTestSidecar();
    try {
      for (let n=0; n<50; n++) {
        const content = `PRIVATE_CONTENT_${n}_<script>${String.fromCodePoint(0x400+n)}`;
        recordExpectations(db, { cycleId: `c${n}`, statements: [content], nowMs: T, dataClassification: "ordinary" });
        recordFriction(db, { kind: "self_reported", note: content, nowMs: T, dataClassification: "ordinary" });
        const lines = sensesForThought(db, { nowMs: T, conversationId: "t" }).lines;
        expect(lines.length).toBeLessThanOrEqual(8);
        expect(lines.join("\n")).not.toContain(content);
        expect(lines.every(line => !line.includes("\n"))).toBe(true);
      }
    } finally { db.close(); }
  });
  it("reads backup age and treats missing or unreadable status as unknown", async () => {
    const { sensesForThought } = await api(); const db = openTestSidecar(); const dataDir = mkdtempSync(join(tmpdir(), "a3-senses-"));
    try {
      const options = { nowMs: T, conversationId: "t", dataDir };
      expect(sensesForThought(db, options).lines).toContain("backup: unknown");
      mkdirSync(join(dataDir, "backups"));
      writeFileSync(join(dataDir, "backups/status.json"), "broken");
      expect(sensesForThought(db, options).lines).toContain("backup: unknown");
      writeFileSync(join(dataDir, "backups/status.json"), JSON.stringify({ last_ok_ms: T-DAY }));
      expect(sensesForThought(db, options).lines).toContain("backup: aging");
    } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
  });
  it.each([false, true])("creates fresh/upgraded decline storage (%s)", async upgrade => {
    await api(); const db = openTestSidecar();
    try {
      if (upgrade) { db.exec("DROP TABLE sense_declines; PRAGMA user_version = 47"); db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 47").run(); openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } }); }
      expect(db.prepare("PRAGMA table_info(sense_declines)").all().map(r => r.name)).toContain("declined_band");
    } finally { db.close(); }
  });
  it("bounds and validates decline authorship", async () => {
    const { isValidSenseClaim } = await api();
    expect(isValidSenseClaim({ decline: [{ sense: "backup", rationale: "I understand", untilMs: T }] })).toBe(true);
    expect(isValidSenseClaim({ decline: [{ sense: "unknown", rationale: "x" }] })).toBe(false);
    expect(isValidSenseClaim({ decline: [{ sense: "backup", rationale: "x".repeat(201) }] })).toBe(false);
    expect(isValidSenseClaim({ decline: [{ sense: "backup", rationale: "x", untilMs: -1 }] })).toBe(false);
  });
});

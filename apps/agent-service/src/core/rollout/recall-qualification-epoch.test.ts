import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  currentBuildIdentity,
  currentContractId,
  listCapabilityStatuses,
  promoteCapability,
  promotionEligible,
  recordBehavioralBreach,
  recordCriticalFailure,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
  recordRecallLiveCutover,
} from "./capabilities.js";
import {
  getCurrentRecallQualificationEpoch,
  getRecallQualificationEpoch,
  listRecallQualificationEpochs,
  startRecallQualificationEpoch,
} from "./recall-qualification-epoch.js";

const OWNER = "doc";
const START = new Date("2026-08-09T12:00:00.000Z");
const RELEASE_ID = currentContractId();

let db: DatabaseSync;

beforeEach(() => {
  db = openNuclearDb(new DatabaseSync(":memory:"));
});

afterEach(() => {
  db.close();
});

function startFirstEpoch(requestKey = "first", authorizedBy = OWNER): string {
  const result = startRecallQualificationEpoch(db, {
    authorizedBy,
    startRequestKey: requestKey,
    expectedCurrentEpochId: null,
  });
  expect(result).toMatchObject({ ok: true, created: true });
  if (result.ok) return result.epochId;
  throw new Error("unreachable");
}

function startSuccessor(requestKey: string, expected: string): string {
  const result = startRecallQualificationEpoch(db, {
    authorizedBy: OWNER,
    startRequestKey: requestKey,
    expectedCurrentEpochId: expected,
  });
  expect(result).toMatchObject({ ok: true, created: true });
  if (result.ok) return result.epochId;
  throw new Error("unreachable");
}

function countCurrentEpochs(target: DatabaseSync): number {
  return Number(
    (
      target.prepare(
        `SELECT COUNT(*) AS c FROM recall_qualification_epochs WHERE status = 'current'`,
      ).get() as { c: number }
    ).c,
  );
}

function countEpochEvents(target: DatabaseSync, epochId: string): number {
  return Number(
    (
      target
        .prepare(
          `SELECT COUNT(*) AS c FROM recall_qualification_events WHERE epoch_id = ?`,
        )
        .get(epochId) as { c: number }
    ).c,
  );
}

function countCapabilityEvents(
  target: DatabaseSync,
  kind: string,
): number {
  return Number(
    (
      target
        .prepare(
          `SELECT COUNT(*) AS c FROM capability_events
           WHERE capability = 'recall' AND release_id = ? AND kind = ?`,
        )
        .get(RELEASE_ID, kind) as { c: number }
    ).c,
  );
}

function seedHistoricalV3Campaign(target: DatabaseSync): void {
  const shadows = Array.from({ length: 25 }, (_, index) => {
    const at = new Date(START.getTime() + index * (7 * 86_400_000 / 24));
    return `('recall', '${RELEASE_ID}', 'live_shadow', 'v3:shadow:${index}', '{}', '${at.toISOString()}', 'ashley-capability-v3', 'v3-build', 0)`;
  }).join(",\n");
  target.exec(`
    INSERT OR IGNORE INTO capability_releases
      (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
    VALUES ('recall', '${RELEASE_ID}', 'observe', '${START.toISOString()}',
            'ashley-capability-v3', 'v3-build', 0);
    INSERT INTO capability_events
      (capability, release_id, kind, source_key, detail_json, occurred_at,
       contract_id, build_identity, model_epoch)
    VALUES
      ('recall', '${RELEASE_ID}', 'isolated_eval', 'v3:seed',
       '{"seeds":5,"passed":true}', '${START.toISOString()}',
       'ashley-capability-v3', 'v3-build', 0),
${shadows};
  `);
  target.exec(`
    UPDATE capability_releases
    SET eval_seed_count = 5, qualified_at = '${START.toISOString()}'
    WHERE capability = 'recall' AND release_id = '${RELEASE_ID}';
  `);
}

function qualifyCapability(
  target: DatabaseSync,
  capability: Parameters<typeof recordIsolatedEvaluation>[1],
  prefix: string,
): void {
  recordIsolatedEvaluation(target, capability, {
    seeds: 3,
    passed: true,
    sourceKey: `${prefix}:seed`,
    occurredAt: START.toISOString(),
  });
  for (let index = 0; index < 25; index++) {
    const at = new Date(START.getTime() + index * (7 * 86_400_000 / 24));
    recordLiveShadowEvent(target, capability, `${prefix}:shadow:${index}`, {
      occurredAt: at.toISOString(),
    });
  }
}

function openTestFileDb(dbPath: string): DatabaseSync {
  return openNuclearDb(new DatabaseSync(dbPath), {
    continuity: openContinuityDb(new DatabaseSync(":memory:")),
  });
}

function recallStatus() {
  return listCapabilityStatuses(db, "apply").find(
    (status) => status.capability === "recall",
  );
}

function removeDirWithRetry(dir: string): void {
  const stall = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(stall, 0, 0, 50);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

type ConcurrentStartResult =
  | {
      ok: true;
      created: boolean;
      epochId: string;
      predecessorEpochId: string | null;
      startedAt: string;
    }
  | { ok: false; reason: string; currentEpochId: string | null }
  | { error: string };

function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`epoch_ready_timeout:${path}`));
      }
    }, 5);
  });
}

async function runConcurrentStarts(input: {
  dbPath: string;
  requestKeys: string[];
  expectedCurrentEpochId: string | null;
}): Promise<ConcurrentStartResult[]> {
  const { dbPath, requestKeys, expectedCurrentEpochId } = input;
  const childPath = fileURLToPath(
    new URL("./epoch-start-child.ts", import.meta.url),
  );
  const entries = requestKeys.map((requestKey, index) => {
    // Index-suffixed coordination tags: duplicated request keys (same-request
    // idempotency tests) must not collide on shared ready/gate/result files.
    const tag = `${index}-${requestKey.replace(/[^a-zA-Z0-9-]/g, "-")}`;
    const readyPath = join(dbPath, `..`, `ready-${tag}`);
    const gatePath = join(dbPath, `..`, `gate-${tag}`);
    const resultPath = join(dbPath, `..`, `result-${tag}`);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        childPath,
        dbPath,
        readyPath,
        gatePath,
        resultPath,
        requestKey,
        expectedCurrentEpochId ?? "",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    const exit = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    return { readyPath, gatePath, resultPath, exit };
  });

  await Promise.all(entries.map((entry) => waitForFile(entry.readyPath)));
  for (const entry of entries) {
    writeFileSync(entry.gatePath, "go", "utf8");
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      const code = await entry.exit;
      if (code !== 0) {
        throw new Error(`epoch start child exited ${code}`);
      }
      return JSON.parse(readFileSync(entry.resultPath, "utf8")) as ConcurrentStartResult;
    }),
  );
  return results;
}

function isCreated(
  result: ConcurrentStartResult,
): result is Extract<ConcurrentStartResult, { ok: true }> {
  return "ok" in result && result.ok === true && result.created === true;
}

function isEpochChanged(
  result: ConcurrentStartResult,
): result is Extract<ConcurrentStartResult, { ok: false }> {
  return "ok" in result && result.ok === false;
}

function isIdempotentReplay(
  result: ConcurrentStartResult,
): result is Extract<ConcurrentStartResult, { ok: true }> {
  return "ok" in result && result.ok === true && result.created === false;
}

describe("Recall qualification epochs", () => {
  it("starts the first epoch only through an explicit owner-authorized CAS", () => {
    expect(getCurrentRecallQualificationEpoch(db)).toBeNull();
    expect(countCurrentEpochs(db)).toBe(0);
    expect(startRecallQualificationEpoch(db, {
      authorizedBy: "",
      startRequestKey: "first",
      expectedCurrentEpochId: null,
    })).toEqual({ ok: false, reason: "authorization_required", currentEpochId: null });

    const result = startRecallQualificationEpoch(db, {
      authorizedBy: OWNER,
      startRequestKey: "first",
      expectedCurrentEpochId: null,
    });
    expect(result).toEqual({
      ok: true,
      created: true,
      epochId: expect.any(String),
      predecessorEpochId: null,
      startedAt: expect.any(String),
    });
    if (!result.ok) return;
    expect(getCurrentRecallQualificationEpoch(db)?.epochId).toBe(result.epochId);
    expect(countCurrentEpochs(db)).toBe(1);
    expect(listRecallQualificationEpochs(db)).toHaveLength(1);

    const retry = startRecallQualificationEpoch(db, {
      authorizedBy: OWNER,
      startRequestKey: "first",
      expectedCurrentEpochId: null,
    });
    expect(retry).toEqual({
      ok: true,
      created: false,
      epochId: result.epochId,
      predecessorEpochId: null,
      startedAt: expect.any(String),
    });
    expect(countCurrentEpochs(db)).toBe(1);
    expect(listRecallQualificationEpochs(db)).toHaveLength(1);
  });

  it("records provenance on the epoch and its qualification events", () => {
    const epochId = startFirstEpoch();
    const epoch = getRecallQualificationEpoch(db, epochId);
    expect(epoch).toMatchObject({
      contractId: RELEASE_ID,
      startedBuildIdentity: currentBuildIdentity(),
      createdBy: OWNER,
      status: "current",
      evalSeedCount: 0,
      qualifiedAt: null,
    });
    recordIsolatedEvaluation(db, "recall", {
      seeds: 3,
      passed: true,
      sourceKey: "prov:seed",
      occurredAt: START.toISOString(),
    });
    const event = db.prepare(
      `SELECT build_identity FROM recall_qualification_events
       WHERE epoch_id = ? AND kind = 'isolated_eval'`,
    ).get(epochId) as { build_identity: string };
    expect(event.build_identity).toBe(currentBuildIdentity());
  });

  it("concurrent first-epoch writers: exactly one winner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-epoch-concurrent-"));
    try {
      const dbPath = join(dir, "nuclear.db");
      openTestFileDb(dbPath).close();

      const results = await runConcurrentStarts({
        dbPath,
        requestKeys: ["concurrent-a", "concurrent-b"],
        expectedCurrentEpochId: null,
      });
      const winners = results.filter(isCreated);
      const losers = results.filter(isEpochChanged);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]).toMatchObject({ ok: false, reason: "epoch_changed" });
      expect("error" in results[0] ? results[0].error : null).toBeNull();
      expect("error" in results[1] ? results[1].error : null).toBeNull();

      const reopened = openNuclearDb(new DatabaseSync(dbPath), { continuityOptional: true });
      try {
        expect(countCurrentEpochs(reopened)).toBe(1);
        expect(listRecallQualificationEpochs(reopened)).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      removeDirWithRetry(dir);
    }
  });

  it("concurrent successor writers: loser never retires the winner's epoch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-epoch-successor-"));
    try {
      const dbPath = join(dir, "nuclear.db");
      const seeded = openTestFileDb(dbPath);
      const first = startRecallQualificationEpoch(seeded, {
        authorizedBy: OWNER,
        startRequestKey: "seed-A",
        expectedCurrentEpochId: null,
      });
      expect(first.ok).toBe(true);
      const epochA = first.ok ? first.epochId : "";
      seeded.close();

      const results = await runConcurrentStarts({
        dbPath,
        requestKeys: ["successor-b", "successor-c"],
        expectedCurrentEpochId: epochA,
      });
      const winners = results.filter(isCreated);
      const losers = results.filter(isEpochChanged);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]).toMatchObject({ ok: false, reason: "epoch_changed" });

      const reopened = openNuclearDb(new DatabaseSync(dbPath), { continuityOptional: true });
      try {
        const current = getCurrentRecallQualificationEpoch(reopened);
        expect(current).not.toBeNull();
        if (winners[0].ok) expect(current?.epochId).toBe(winners[0].epochId);
        const a = getRecallQualificationEpoch(reopened, epochA);
        expect(a).toMatchObject({ status: "retired" });
        expect(a?.retiredAt).not.toBeNull();
        expect(countCurrentEpochs(reopened)).toBe(1);
        expect(listRecallQualificationEpochs(reopened)).toHaveLength(2);
      } finally {
        reopened.close();
      }
    } finally {
      removeDirWithRetry(dir);
    }
  });

  it("same-request concurrent first-epoch writers: both converge on the SAME epoch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-epoch-same-key-first-"));
    try {
      const dbPath = join(dir, "nuclear.db");
      openTestFileDb(dbPath).close();

      const results = await runConcurrentStarts({
        dbPath,
        requestKeys: ["same-first", "same-first"],
        expectedCurrentEpochId: null,
      });
      const created = results.filter(isCreated);
      const replays = results.filter(isIdempotentReplay);
      expect(created).toHaveLength(1);
      expect(replays).toHaveLength(1);
      expect(created[0].predecessorEpochId).toBeNull();
      expect(replays[0].epochId).toBe(created[0].epochId);
      expect(replays[0].predecessorEpochId).toBeNull();

      const reopened = openNuclearDb(new DatabaseSync(dbPath), { continuityOptional: true });
      try {
        expect(countCurrentEpochs(reopened)).toBe(1);
        expect(listRecallQualificationEpochs(reopened)).toHaveLength(1);
        expect(getCurrentRecallQualificationEpoch(reopened)?.epochId).toBe(created[0].epochId);
      } finally {
        reopened.close();
      }
    } finally {
      removeDirWithRetry(dir);
    }
  });

  it("same-request concurrent successor writers: both converge on the SAME successor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recall-epoch-same-key-successor-"));
    try {
      const dbPath = join(dir, "nuclear.db");
      const seeded = openTestFileDb(dbPath);
      const first = startRecallQualificationEpoch(seeded, {
        authorizedBy: OWNER,
        startRequestKey: "seed-same-succ",
        expectedCurrentEpochId: null,
      });
      expect(first.ok).toBe(true);
      const epochA = first.ok ? first.epochId : "";
      seeded.close();

      const results = await runConcurrentStarts({
        dbPath,
        requestKeys: ["same-succ", "same-succ"],
        expectedCurrentEpochId: epochA,
      });
      const created = results.filter(isCreated);
      const replays = results.filter(isIdempotentReplay);
      expect(created).toHaveLength(1);
      expect(replays).toHaveLength(1);
      expect(created[0].predecessorEpochId).toBe(epochA);
      expect(replays[0].epochId).toBe(created[0].epochId);

      const reopened = openNuclearDb(new DatabaseSync(dbPath), { continuityOptional: true });
      try {
        const current = getCurrentRecallQualificationEpoch(reopened);
        expect(current?.epochId).toBe(created[0].epochId);
        expect(getRecallQualificationEpoch(reopened, epochA)).toMatchObject({
          status: "retired",
        });
        expect(countCurrentEpochs(reopened)).toBe(1);
        expect(listRecallQualificationEpochs(reopened)).toHaveLength(2);
      } finally {
        reopened.close();
      }
    } finally {
      removeDirWithRetry(dir);
    }
  });

  it("isolates the old v3 campaign: historical evidence cannot qualify a fresh epoch", () => {
    seedHistoricalV3Campaign(db);
    expect(promotionEligible(db, "recall")).toBe(false);

    const epochId = startFirstEpoch();
    expect(promotionEligible(db, "recall")).toBe(false);
    expect(recallStatus()).toMatchObject({
      state: "observe",
      promotionEligible: false,
      evalSeedCount: 0,
      qualifiedAt: null,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
      qualificationEpochId: epochId,
    });
    expect(countEpochEvents(db, epochId)).toBe(0);
    expect(countCapabilityEvents(db, "live_shadow")).toBe(25);
    expect(countCapabilityEvents(db, "isolated_eval")).toBe(1);
    const release = db.prepare(
      `SELECT eval_seed_count, qualified_at FROM capability_releases
       WHERE capability = 'recall' AND release_id = ?`,
    ).get(RELEASE_ID) as { eval_seed_count: number; qualified_at: string };
    expect(release.eval_seed_count).toBe(5);
    expect(release.qualified_at).toBe(START.toISOString());
  });

  it("qualifies only the current epoch and never lets a retired epoch qualify", () => {
    const epochB = startFirstEpoch("epoch-B");
    qualifyCapability(db, "recall", "B");
    expect(promotionEligible(db, "recall")).toBe(true);
    expect(recallStatus()).toMatchObject({
      promotionEligible: true,
      evalSeedCount: 3,
      liveShadowEvents: 25,
      liveShadowSpanDays: 7,
      qualificationEpochId: epochB,
    });

    const epochC = startSuccessor("epoch-C", epochB);
    expect(getRecallQualificationEpoch(db, epochB)).toMatchObject({
      status: "retired",
      evalSeedCount: 3,
    });
    expect(countEpochEvents(db, epochB)).toBe(26);
    expect(countEpochEvents(db, epochC)).toBe(0);
    expect(promotionEligible(db, "recall")).toBe(false);
    expect(recallStatus()).toMatchObject({
      promotionEligible: false,
      evalSeedCount: 0,
      qualifiedAt: null,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
      qualificationEpochId: epochC,
    });
  });

  it("keeps the same genuine source_key independent across epochs and idempotent within one", () => {
    const epochB = startFirstEpoch("epoch-B");
    const first = recordLiveShadowEvent(db, "recall", "shared:key", {
      occurredAt: START.toISOString(),
    });
    const retry = recordLiveShadowEvent(db, "recall", "shared:key", {
      occurredAt: new Date(START.getTime() + 1000).toISOString(),
    });
    expect(first).toEqual({ recorded: true });
    expect(retry).toEqual({ recorded: false });
    expect(countEpochEvents(db, epochB)).toBe(1);

    const epochC = startSuccessor("epoch-C", epochB);
    const inC = recordLiveShadowEvent(db, "recall", "shared:key", {
      occurredAt: new Date(START.getTime() + 2000).toISOString(),
    });
    expect(inC).toEqual({ recorded: true });
    expect(countEpochEvents(db, epochB)).toBe(1);
    expect(countEpochEvents(db, epochC)).toBe(1);
    const provenance = db.prepare(
      `SELECT COUNT(*) AS c FROM capability_events
       WHERE capability = 'recall' AND release_id = ? AND kind = 'live_shadow'
         AND source_key = 'shared:key'`,
    ).get(RELEASE_ID) as { c: number };
    expect(provenance.c).toBe(1);
  });

  it("dual-write is atomic: a failure at any stage rolls back provenance, mirror, and aggregate", () => {
    const injections: Array<{ name: string; ddl: string }> = [
      {
        name: "before-provenance",
        ddl: `CREATE TRIGGER inject_dual_write BEFORE INSERT ON capability_events
              BEGIN SELECT RAISE(ABORT, 'injected:pre-provenance'); END;`,
      },
      {
        name: "between-ledgers",
        ddl: `CREATE TRIGGER inject_dual_write BEFORE INSERT ON recall_qualification_events
              BEGIN SELECT RAISE(ABORT, 'injected:pre-epoch-event'); END;`,
      },
      {
        name: "pre-aggregate",
        ddl: `CREATE TRIGGER inject_dual_write BEFORE UPDATE ON recall_qualification_epochs
              BEGIN SELECT RAISE(ABORT, 'injected:pre-aggregate'); END;`,
      },
      {
        name: "pre-commit",
        ddl: `CREATE TRIGGER inject_dual_write AFTER UPDATE ON recall_qualification_epochs
              BEGIN SELECT RAISE(ABORT, 'injected:pre-commit'); END;`,
      },
    ];
    for (const { name, ddl } of injections) {
      const target = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const epochResult = startRecallQualificationEpoch(target, {
          authorizedBy: OWNER,
          startRequestKey: `atomic:${name}`,
          expectedCurrentEpochId: null,
        });
        expect(epochResult).toMatchObject({ ok: true, created: true });
        const epochId = epochResult.ok ? epochResult.epochId : "";
        target.exec(ddl);
        expect(() => recordIsolatedEvaluation(target, "recall", {
          seeds: 3,
          passed: true,
          sourceKey: `atomic:${name}`,
          occurredAt: START.toISOString(),
        })).toThrow(/injected/);
        expect(countCapabilityEvents(target, "isolated_eval")).toBe(0);
        expect(countEpochEvents(target, epochId)).toBe(0);
        expect(getRecallQualificationEpoch(target, epochId)).toMatchObject({
          evalSeedCount: 0,
          qualifiedAt: null,
        });
        target.exec("DROP TRIGGER inject_dual_write");
        recordIsolatedEvaluation(target, "recall", {
          seeds: 3,
          passed: true,
          sourceKey: `atomic:${name}`,
          occurredAt: START.toISOString(),
        });
        expect(countCapabilityEvents(target, "isolated_eval")).toBe(1);
        expect(countEpochEvents(target, epochId)).toBe(1);
        expect(getRecallQualificationEpoch(target, epochId)).toMatchObject({
          evalSeedCount: 3,
          qualifiedAt: expect.any(String),
        });
      } finally {
        target.close();
      }
    }
  });

  it("live_shadow dual-write is atomic: a mid-write failure rolls back both ledgers, retry converges", () => {
    const epochId = startFirstEpoch("atomic-shadow");
    db.exec(
      `CREATE TRIGGER inject_shadow BEFORE INSERT ON recall_qualification_events
       BEGIN SELECT RAISE(ABORT, 'injected:shadow'); END;`,
    );
    expect(() => recordLiveShadowEvent(db, "recall", "atomic:shadow:1", {
      occurredAt: START.toISOString(),
    })).toThrow(/injected/);
    expect(countCapabilityEvents(db, "live_shadow")).toBe(0);
    expect(countEpochEvents(db, epochId)).toBe(0);
    db.exec("DROP TRIGGER inject_shadow");
    expect(recordLiveShadowEvent(db, "recall", "atomic:shadow:1", {
      occurredAt: START.toISOString(),
    })).toEqual({ recorded: true });
    expect(countCapabilityEvents(db, "live_shadow")).toBe(1);
    expect(countEpochEvents(db, epochId)).toBe(1);
  });

  it("participates atomically in an enclosing transaction: outer rollback removes all three writes", () => {
    const epochId = startFirstEpoch("outer");
    db.exec("BEGIN IMMEDIATE");
    try {
      recordIsolatedEvaluation(db, "recall", {
        seeds: 3,
        passed: true,
        sourceKey: "outer:1",
        occurredAt: START.toISOString(),
      });
    } finally {
      db.exec("ROLLBACK");
    }
    expect(countCapabilityEvents(db, "isolated_eval")).toBe(0);
    expect(countEpochEvents(db, epochId)).toBe(0);
    expect(getRecallQualificationEpoch(db, epochId)).toMatchObject({
      evalSeedCount: 0,
      qualifiedAt: null,
    });
    recordIsolatedEvaluation(db, "recall", {
      seeds: 3,
      passed: true,
      sourceKey: "outer:1",
      occurredAt: START.toISOString(),
    });
    expect(countCapabilityEvents(db, "isolated_eval")).toBe(1);
    expect(countEpochEvents(db, epochId)).toBe(1);
    expect(getRecallQualificationEpoch(db, epochId)).toMatchObject({
      evalSeedCount: 3,
      qualifiedAt: expect.any(String),
    });
  });

  it("never creates an epoch implicitly: no-epoch recording is provenance-only and fail-closed", () => {
    expect(getCurrentRecallQualificationEpoch(db)).toBeNull();
    expect(promotionEligible(db, "recall")).toBe(false);
    expect(recallStatus()).toMatchObject({
      promotionEligible: false,
      evalSeedCount: 0,
      qualifiedAt: null,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
      qualificationEpochId: null,
    });
    expect(recordLiveShadowEvent(db, "recall", "no-epoch", {})).toEqual({
      recorded: false,
      reason: "recall_qualification_epoch_unavailable",
    });
    expect(() => recordIsolatedEvaluation(db, "recall", {
      seeds: 3,
      passed: true,
      sourceKey: "no-epoch",
    })).not.toThrow();
    expect(getCurrentRecallQualificationEpoch(db)).toBeNull();
    expect(countCurrentEpochs(db)).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM recall_qualification_events").get() as {
        c: number;
      },
    ).toEqual({ c: 0 });
    expect(countCapabilityEvents(db, "live_shadow")).toBe(1);
    expect(countCapabilityEvents(db, "isolated_eval")).toBe(1);
    for (let index = 0; index < 25; index++) {
      const at = new Date(START.getTime() + index * (7 * 86_400_000 / 24));
      recordLiveShadowEvent(db, "recall", `no-epoch:shadow:${index}`, {
        occurredAt: at.toISOString(),
      });
    }
    expect(countCurrentEpochs(db)).toBe(0);
    expect(recallStatus()).toMatchObject({
      promotionEligible: false,
      evalSeedCount: 0,
      qualifiedAt: null,
      liveShadowEvents: 0,
      liveShadowSpanDays: 0,
      qualificationEpochId: null,
    });
  });

  it("a missing epoch after corruption is never recreated by recording", () => {
    const epochId = startFirstEpoch();
    db.exec("DELETE FROM recall_qualification_epochs");
    expect(getCurrentRecallQualificationEpoch(db)).toBeNull();
    expect(promotionEligible(db, "recall")).toBe(false);
    expect(recordLiveShadowEvent(db, "recall", "corrupt", {})).toEqual({
      recorded: false,
      reason: "recall_qualification_epoch_unavailable",
    });
    expect(() => recordIsolatedEvaluation(db, "recall", {
      seeds: 3,
      passed: true,
      sourceKey: "corrupt",
    })).not.toThrow();
    expect(
      db.prepare(
        `SELECT COUNT(*) AS c FROM recall_qualification_epochs WHERE epoch_id = ?`,
      ).get(epochId) as { c: number },
    ).toEqual({ c: 0 });
    expect(countCurrentEpochs(db)).toBe(0);
    expect(getCurrentRecallQualificationEpoch(db)).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM recall_qualification_events").get() as {
        c: number;
      },
    ).toEqual({ c: 0 });
    expect(countCapabilityEvents(db, "live_shadow")).toBe(1);
    expect(countCapabilityEvents(db, "isolated_eval")).toBe(1);
    expect(promotionEligible(db, "recall")).toBe(false);
  });

  it("keeps safety history on the authoritative v3 release", () => {
    startFirstEpoch();
    recordBehavioralBreach(db, "recall", "breach:1", "first breach", {
      occurredAt: new Date(START.getTime() - 2 * 86_400_000).toISOString(),
    });
    recordBehavioralBreach(db, "recall", "breach:2", "second breach", {
      occurredAt: new Date(START.getTime() - 86_400_000).toISOString(),
    });
    const release = db.prepare(
      `SELECT state FROM capability_releases WHERE capability = 'recall' AND release_id = ?`,
    ).get(RELEASE_ID) as { state: string };
    expect(release.state).toBe("rolled_back");
    expect(countCapabilityEvents(db, "behavioral_breach")).toBe(2);
    expect(getCurrentRecallQualificationEpoch(db)).toMatchObject({ status: "current" });
    expect(
      (
        db.prepare("SELECT COUNT(*) AS c FROM recall_qualification_events").get() as {
          c: number;
        }
      ).c,
    ).toBe(0);
  });

  it("keeps critical failure on the authoritative v3 release", () => {
    startFirstEpoch();
    recordCriticalFailure(db, "recall", "cf:1", "corruption", "corrupted recall");
    const release = db.prepare(
      `SELECT state, failure_kind FROM capability_releases
       WHERE capability = 'recall' AND release_id = ?`,
    ).get(RELEASE_ID) as { state: string; failure_kind: string };
    expect(release.state).toBe("disabled");
    expect(release.failure_kind).toBe("corruption");
    expect(countCapabilityEvents(db, "critical_failure")).toBe(1);
    expect(getCurrentRecallQualificationEpoch(db)).toMatchObject({ status: "current" });
  });

  it("leaves non-Recall capabilities completely unchanged", () => {
    const before = db.prepare(
      `SELECT capability, state, eval_seed_count FROM capability_releases ORDER BY capability`,
    ).all();
    const beforeEvents = db.prepare(
      `SELECT COUNT(*) AS c FROM capability_events`,
    ).get() as { c: number };

    const epochId = startFirstEpoch();
    qualifyCapability(db, "reading", "reading");

    const readingStatus = listCapabilityStatuses(db, "apply").find(
      (status) => status.capability === "reading",
    );
    expect(readingStatus).toMatchObject({
      state: "observe",
      promotionEligible: true,
      evalSeedCount: 3,
      liveShadowEvents: 25,
      liveShadowSpanDays: 7,
      qualificationEpochId: null,
    });
    expect(
      db.prepare(
        `SELECT COUNT(*) AS c FROM capability_events
         WHERE capability = 'reading' AND kind = 'live_shadow'`,
      ).get() as { c: number },
    ).toEqual({ c: 25 });
    expect(countEpochEvents(db, epochId)).toBe(0);
    expect(
      db.prepare(
        `SELECT capability, state, eval_seed_count FROM capability_releases ORDER BY capability`,
      ).all(),
    ).not.toEqual(before);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM capability_events`).get() as { c: number },
    ).toEqual({ c: beforeEvents.c + 26 });
  });

  it("promotes from current-epoch qualification and mutates only the v3 authority release", () => {
    const epochId = startFirstEpoch();
    qualifyCapability(db, "recall", "K");
    expect(promotionEligible(db, "recall")).toBe(true);

    const promoted = promoteCapability(db, "recall", { authorizedBy: OWNER });
    expect(promoted).toEqual({ ok: true, state: "active" });
    const release = db.prepare(
      `SELECT state, promoted_at, eval_seed_count, qualified_at
       FROM capability_releases WHERE capability = 'recall' AND release_id = ?`,
    ).get(RELEASE_ID) as {
      state: string;
      promoted_at: string;
      eval_seed_count: number;
      qualified_at: string;
    };
    expect(release.state).toBe("active");
    expect(release.promoted_at).not.toBeNull();
    expect(release.eval_seed_count).toBe(0);
    expect(release.qualified_at).toBeNull();
    expect(countCapabilityEvents(db, "operator_promote")).toBe(1);
    expect(
      db.prepare(
        `SELECT COUNT(*) AS c FROM capability_releases
         WHERE capability = 'recall' AND release_id <> ?`,
      ).get(RELEASE_ID) as { c: number },
    ).toEqual({ c: 0 });
    expect(getRecallQualificationEpoch(db, epochId)).toMatchObject({ status: "current" });
    expect(promotionEligible(db, "recall")).toBe(false);
  });

  it("starting and retiring epochs leaves authority state and safety history at delta zero", () => {
    const epochB = startFirstEpoch("L-B");
    qualifyCapability(db, "recall", "L-B");
    expect(promoteCapability(db, "recall", { authorizedBy: OWNER })).toEqual({
      ok: true,
      state: "active",
    });
    recordRecallLiveCutover(db, "doc", {
      authorizedBy: OWNER,
      masterMode: "observe",
    });
    recordBehavioralBreach(db, "recall", "L:breach:1", "first breach", {
      occurredAt: new Date(START.getTime() - 2 * 86_400_000).toISOString(),
    });
    recordBehavioralBreach(db, "recall", "L:breach:2", "second breach", {
      occurredAt: new Date(START.getTime() - 86_400_000).toISOString(),
    });
    recordCriticalFailure(db, "recall", "L:cf:1", "corruption", "corrupted");

    const snapshotReleases = db.prepare(
      `SELECT capability, release_id, state, eval_seed_count, qualified_at,
              promoted_at, rolled_back_at, failure_kind, failure_reason
       FROM capability_releases ORDER BY capability, release_id`,
    ).all();
    const snapshotEvents = db.prepare(
      `SELECT capability, release_id, kind, source_key, detail_json, occurred_at
       FROM capability_events ORDER BY id`,
    ).all();
    const snapshotCutovers = db.prepare(
      `SELECT owner_id, capability, release_id, cutoff_message_id, authorized_by, created_at
       FROM recall_live_cutovers ORDER BY owner_id`,
    ).all();

    const epochC = startSuccessor("L-C", epochB);

    expect(
      db.prepare(
        `SELECT capability, release_id, state, eval_seed_count, qualified_at,
                promoted_at, rolled_back_at, failure_kind, failure_reason
         FROM capability_releases ORDER BY capability, release_id`,
      ).all(),
    ).toEqual(snapshotReleases);
    expect(
      db.prepare(
        `SELECT capability, release_id, kind, source_key, detail_json, occurred_at
         FROM capability_events ORDER BY id`,
      ).all(),
    ).toEqual(snapshotEvents);
    expect(
      db.prepare(
        `SELECT owner_id, capability, release_id, cutoff_message_id, authorized_by, created_at
         FROM recall_live_cutovers ORDER BY owner_id`,
      ).all(),
    ).toEqual(snapshotCutovers);
    expect(countEpochEvents(db, epochB)).toBe(26);
    expect(countEpochEvents(db, epochC)).toBe(0);
    expect(getRecallQualificationEpoch(db, epochB)).toMatchObject({ status: "retired" });
    expect(getRecallQualificationEpoch(db, epochC)).toMatchObject({ status: "current" });
  });
});

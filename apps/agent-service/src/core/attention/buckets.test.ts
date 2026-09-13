import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi, afterEach } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  insertQueuedRequest,
  earliestLegalDispatchMs,
  markRunning,
  completeRequest,
  currentTpmUsage,
} from "./ledger.js";
import { createFakeClock } from "./types.js";

const originalRps = env.mistralRequestsPerSecond;
const originalTpm = env.mistralTokensPerMinute;

function openDb(): DatabaseSync {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  return openNuclearDb(new DatabaseSync(":memory:"), { continuity });
}

describe("quota bucket isolation", () => {
  afterEach(() => {
    env.mistralRequestsPerSecond = originalRps;
    env.mistralTokensPerMinute = originalTpm;
    vi.restoreAllMocks();
  });

  it("independent buckets do not share TPM windows", () => {
    const db = openDb();
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    env.mistralRequestsPerSecond = 1_000;
    env.mistralTokensPerMinute = 100;
    const clock = createFakeClock(1_000_000);
    const nowIso = new Date(clock.nowMs()).toISOString();

    // Saturate bucket A within the TPM window (reserved + terminal actual).
    db.prepare(
      `INSERT INTO attention_requests
         (lane, purpose, model_alias, provider_id, route_alias, quota_bucket,
          state, outcome, dispatch_started_at, actual_input_tokens,
          actual_output_tokens, estimated_input_tokens, estimated_output_tokens,
          reserved_input_tokens, reserved_output_tokens, queued_at, eligible_at,
          age_origin_at, created_at)
       VALUES ('interactive', 'expression', 'm', 'mistral', NULL, 'mistral:m',
               'terminal', 'completed', ?, 100, 0, 100, 0, 100, 0, ?, ?, ?, ?)`,
    ).run(nowIso, nowIso, nowIso, nowIso, nowIso);

    // Bucket A exhausted: demand of 50 cannot fit the 100-token TPM limit.
    const earliestA = earliestLegalDispatchMs(db, 50, clock, "mistral:m");
    expect(earliestA).toBeGreaterThan(clock.nowMs());
    expect(currentTpmUsage(db, clock, "mistral:m")).toBe(100);

    // Bucket B is untouched: demand of 50 fits immediately.
    const earliestB = earliestLegalDispatchMs(db, 50, clock, "mistral:other");
    expect(earliestB).toBe(clock.nowMs());
    expect(currentTpmUsage(db, clock, "mistral:other")).toBe(0);

    db.close();
  });

  it("inserts queued requests with the supplied bucket and provider", () => {
    const db = openDb();
    const clock = createFakeClock(1_000_000);
    const id = insertQueuedRequest(
      db,
      {
        lane: "interactive",
        purpose: "expression",
        modelAlias: "m",
        providerId: "groq",
        quotaBucket: "groq:llama",
        routeAlias: "ashley_expression",
        estimatedInputTokens: 10,
        estimatedOutputTokens: 20,
      },
      clock,
    );
    const row = db
      .prepare(
        `SELECT provider_id, route_alias, quota_bucket FROM attention_requests WHERE id = ?`,
      )
      .get(id) as { provider_id: string; route_alias: string | null; quota_bucket: string };
    expect(row).toMatchObject({
      provider_id: "groq",
      route_alias: "ashley_expression",
      quota_bucket: "groq:llama",
    });

    const nowIso = new Date(clock.nowMs()).toISOString();
    // Simulate admission (queued -> reserved) before markRunning's precondition.
    db.prepare(
      `UPDATE attention_requests SET state = 'reserved', reserved_at = ? WHERE id = ?`,
    ).run(nowIso, id);
    markRunning(db, id, clock);
    completeRequest(
      db,
      id,
      {
        outcome: "completed",
        errorClass: null,
        actualInput: 10,
        actualOutput: 0,
      },
      clock,
    );
    expect(currentTpmUsage(db, clock, "groq:llama")).toBe(10);
    db.close();
  });
});

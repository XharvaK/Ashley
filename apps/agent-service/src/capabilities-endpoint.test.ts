import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { env } from "./env.js";
import { createServer } from "./server.js";
import type { AgentManager } from "./agent.js";
import { AshleyCore } from "./core/runtime.js";
import { openNuclearDb } from "./core/db.js";
import {
  currentContractId,
  promoteCapability,
  recordIsolatedEvaluation,
  recordLiveShadowEvent,
  recordRecallLiveCutover,
} from "./core/rollout/capabilities.js";
import type { CapabilityActivationReadiness } from "./core/rollout/capabilities.js";
import { startDeterministicRecallEpoch } from "./core/rollout/recall-epoch-test-util.js";
import {
  C1_EVALUATION_DEFINITION_HASH,
  C1_EVALUATION_DEFINITION_ID,
  C1_EVALUATION_DEFINITION_VERSION,
  C1_REQUIRED_EVAL_SEEDS,
  recordMemoryEvidenceIsolatedEvaluation,
  recordMemoryEvidenceLiveShadow,
  startMemoryEvidenceQualificationEpoch,
} from "./core/rollout/memory-evidence-qualification-epoch.js";
import { insertMessage, resolveActiveThread } from "./core/memory/threads.js";
import { upsertFact } from "./core/memory/facts.js";

const start = new Date("2026-07-01T00:00:00.000Z");
const OWNER = "doc";
const INTRUDER = "intruder";

function makeDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function makeManager(
  db: DatabaseSync,
  options: {
    state?: "ready" | "paused";
    expressionQuiesced?: boolean;
    tick?: (ownerId: string) => Promise<unknown>;
    activationReadiness?: (capability: string) => CapabilityActivationReadiness;
  } = {},
): AgentManager {
  const core = new AshleyCore(db);
  if (options.activationReadiness) {
    core.configureCapabilityActivationReadiness(options.activationReadiness);
  }
  return {
    getCognitiveKernel: () => "v021" as const,
    getState: () => options.state ?? "ready",
    isPaused: () => (options.state ?? "ready") === "paused",
    getUptimeSec: () => 0,
    getProviderState: () => "unavailable",
    tickCognitiveIdle: options.tick ?? vi.fn(async () => ({
      processed: 0,
      reason: "test",
    })),
    core: {
      getDatabase: () => db,
      promoteCapability: (input: Parameters<AshleyCore["promoteCapability"]>[0]) =>
        core.promoteCapability(input),
      operatorRollbackCapability: (input: { capability: string; authorizedBy: string }) =>
        core.operatorRollbackCapability(input),
      recordCapabilityEvaluation: (input: {
        capability: string;
        seeds: number;
        passed: boolean;
        sourceKey: string;
      }) => core.recordCapabilityEvaluation(input),
      startMemoryEvidenceQualificationEpoch: (
        input: Parameters<AshleyCore["startMemoryEvidenceQualificationEpoch"]>[0],
      ) =>
        core.startMemoryEvidenceQualificationEpoch(input),
      listMemoryEvidenceQualificationEpochs: (ownerId: string) =>
        core.listMemoryEvidenceQualificationEpochs(ownerId),
      recordMemoryEvidenceEvaluation: (
        input: Parameters<AshleyCore["recordMemoryEvidenceEvaluation"]>[0],
      ) =>
        core.recordMemoryEvidenceEvaluation(input),
      getMemoryEvidenceCutoverReadiness: (
        input: Parameters<AshleyCore["getMemoryEvidenceCutoverReadiness"]>[0],
      ) =>
        core.getMemoryEvidenceCutoverReadiness(input),
      executeMemoryEvidenceCutover: (
        input: Parameters<AshleyCore["executeMemoryEvidenceCutover"]>[0],
      ) =>
        core.executeMemoryEvidenceCutover(input),
      isExpressionQuiesced: () => options.expressionQuiesced ?? true,
    },
  } as unknown as AgentManager;
}

function qualify(
  db: DatabaseSync,
  capability: "reading" | "recall" | "mind_state" | "thought",
): void {
  if (capability === "recall") startDeterministicRecallEpoch(db);
  recordIsolatedEvaluation(db, capability, {
    seeds: 3,
    passed: true,
    sourceKey: `${capability}:eval`,
    occurredAt: start.toISOString(),
  });
  for (let index = 0; index < 25; index++) {
    const at = new Date(start.getTime() + index * (7 * 86_400_000 / 24));
    recordLiveShadowEvent(db, capability, `${capability}:${index}`, {
      occurredAt: at.toISOString(),
    });
  }
}

function prepareC1Epoch(db: DatabaseSync, requestKey: string): string {
  qualify(db, "recall");
  expect(promoteCapability(db, "recall", {
    releaseId: currentContractId(),
    authorizedBy: OWNER,
  })).toMatchObject({ ok: true, state: "active" });
  expect(recordRecallLiveCutover(db, OWNER, {
    authorizedBy: OWNER,
    masterMode: "observe",
  })).toMatchObject({ success: true });
  const started = startMemoryEvidenceQualificationEpoch(db, {
    ownerId: OWNER,
    startRequestKey: requestKey,
    predecessorEpochId: null,
  });
  expect(started).toMatchObject({ ok: true, created: true });
  if (!started.ok) throw new Error("endpoint_c1_epoch_setup_failed");
  return started.epochId;
}

function seedC1Evidence(db: DatabaseSync, epochId: string): void {
  void epochId;
  expect(recordMemoryEvidenceIsolatedEvaluation(db, {
    ownerId: OWNER,
    sourceKey: `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:endpoint-run`,
    definitionId: C1_EVALUATION_DEFINITION_ID,
    definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
    definitionHash: C1_EVALUATION_DEFINITION_HASH,
    seeds: C1_REQUIRED_EVAL_SEEDS.map((id) => ({ id, passed: true })),
  })).toEqual({ recorded: true });
  const startAt = new Date("2026-07-01T00:00:00.000Z");
  for (let index = 0; index < 24; index += 1) {
    expect(recordMemoryEvidenceLiveShadow(db, {
      ownerId: OWNER,
      sourceKey: `c1-shadow:v1:decision:${index + 1}`,
      decisionClass: "same_current",
      qualifies: true,
      trigger: "reactive",
      sourceCount: 1,
      detail: { decisionId: String(index + 1) },
      occurredAt: new Date(startAt.getTime() + index * (7 * 86_400_000 / 24)).toISOString(),
    })).toEqual({ recorded: true });
  }
  expect(recordMemoryEvidenceLiveShadow(db, {
    ownerId: OWNER,
    sourceKey: "c1-shadow:v1:decision:25",
    decisionClass: "would_narrow",
    qualifies: true,
    trigger: "proactive",
    sourceCount: 1,
    detail: { decisionId: "25" },
    occurredAt: new Date(startAt.getTime() + 7 * 86_400_000).toISOString(),
  })).toEqual({ recorded: true });
}

function seedOwnerBootstrapC1Evidence(db: DatabaseSync): void {
  expect(recordMemoryEvidenceIsolatedEvaluation(db, {
    ownerId: OWNER,
    sourceKey: `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:endpoint-owner-bootstrap-run`,
    definitionId: C1_EVALUATION_DEFINITION_ID,
    definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
    definitionHash: C1_EVALUATION_DEFINITION_HASH,
    seeds: C1_REQUIRED_EVAL_SEEDS.map((id) => ({ id, passed: true })),
  })).toEqual({ recorded: true });
  expect(recordMemoryEvidenceLiveShadow(db, {
    ownerId: OWNER,
    sourceKey: "c1-shadow:v1:decision:1",
    decisionClass: "same_current",
    qualifies: true,
    trigger: "reactive",
    sourceCount: 1,
    detail: { decisionId: "1" },
  })).toEqual({ recorded: true });
  expect(recordMemoryEvidenceLiveShadow(db, {
    ownerId: OWNER,
    sourceKey: "c1-shadow:v1:decision:2",
    decisionClass: "would_narrow",
    qualifies: true,
    trigger: "proactive",
    sourceCount: 1,
    detail: { decisionId: "2" },
  })).toEqual({ recorded: true });
}

// The service token and Owner actor are what the bot presents; these tests
// exercise authorization inside the routes (transport-auth.test.ts covers
// their absence).
const TEST_BOT_TOKEN = "capabilities-test-bot-token";
const AUTH_HEADERS = { "X-Ashley-Bot-Service": TEST_BOT_TOKEN, "X-Ashley-Actor": OWNER };

async function post(
  app: ReturnType<typeof createServer>,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    return { status: response.status, body: payload };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function get(
  app: ReturnType<typeof createServer>,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: AUTH_HEADERS });
    const payload = await response.json();
    return { status: response.status, body: payload };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function withServer(
  db: DatabaseSync,
  fn: (app: ReturnType<typeof createServer>) => Promise<void>,
  managerOptions: Parameters<typeof makeManager>[1] = {},
): Promise<void> {
  const originalDiscordOwnerId = env.discordOwnerId;
  const originalMemoryOwnerId = env.memoryOwnerId;
  const originalPersonaEvalMode = env.personaEvalMode;
  env.discordOwnerId = OWNER;
  env.memoryOwnerId = OWNER;
  try {
    const app = createServer(makeManager(db, managerOptions), { botServiceToken: TEST_BOT_TOKEN });
    await fn(app);
  } finally {
    env.discordOwnerId = originalDiscordOwnerId;
    env.memoryOwnerId = originalMemoryOwnerId;
    env.personaEvalMode = originalPersonaEvalMode;
  }
}

describe("memory correction endpoints", () => {
  it("keeps a requested apply observe-only and exposes owner-scoped diagnostics", async () => {
    const db = makeDb();
    try {
      const threadId = resolveActiveThread(db, OWNER, "discord");
      const factSourceMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER,
        role: "user",
        text: "I like coffee.",
        channel: "discord",
      });
      const factId = upsertFact(db, {
        ownerId: OWNER,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId: factSourceMessageId,
      });
      const assertionId = Number((db.prepare(
        "SELECT id FROM memory_assertions WHERE legacy_fact_id = ?",
      ).get(factId) as { id?: number } | undefined)?.id);
      const correctionSourceMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER,
        role: "user",
        text: "The stored coffee memory is wrong.",
        channel: "discord",
      });

      await withServer(db, async (app) => {
        const write = await post(app, "/nuclear/memory/corrections", {
          userId: OWNER,
          sourceMessageId: correctionSourceMessageId,
          correctionOrdinal: 1,
          admissionPath: "typed_control",
          class: "INTERPRETATION_INVALIDATION",
          scopeText: "stored coffee memory",
          targets: [{
            assertionId,
            inclusionReason: "owner_confirmed",
            resolutionBasis: "owner_confirmed",
          }],
          capabilityMode: "apply",
        });
        expect(write.status).toBe(200);
        expect(write.body).toMatchObject({
          requestedMode: "apply",
          capabilityMode: "observe",
          fanout: null,
          admitted: {
            correction: {
              lifecycleStatus: "observe_recorded",
              barrierId: null,
            },
            receipt: {
              barrierCommitted: false,
              fanoutState: "not_started",
            },
          },
        });

        const diagnostics = await get(app, "/nuclear/memory/corrections?owner_id=doc");
        expect(diagnostics.status).toBe(200);
        expect(diagnostics.body).toMatchObject({
          currentnessAuthority: "mem_facts",
          correctionSeq: 1,
          corrections: [expect.objectContaining({
            lifecycle_status: "observe_recorded",
            stop_committed: false,
          })],
        });
      });
    } finally {
      db.close();
    }
  });
});

describe("POST /nuclear/capabilities/promote (operator endpoint)", () => {
  it("promotes an eligible live-shadow capability for the owner", async () => {
    const db = makeDb();
    try {
      qualify(db, "reading");
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, state: "active" });
      });
    } finally {
      db.close();
    }
  });

  it("returns not_eligible for an ineligible live-shadow capability", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: false, reason: "not_eligible" });
      });
    } finally {
      db.close();
    }
  });

  it("supports explicit owner bootstrap without maturation evidence and keeps it owner-bound", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const ordinary = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(ordinary.status).toBe(200);
        expect(ordinary.body).toMatchObject({ ok: false, reason: "not_eligible" });

        const denied = await post(app, "/nuclear/capabilities/promote", {
          userId: INTRUDER,
          capability: "reading",
          activationPath: "owner_bootstrap",
        });
        expect(denied.status).toBe(403);

        const promoted = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
          activationPath: "owner_bootstrap",
        });
        expect(promoted.status).toBe(200);
        expect(promoted.body).toMatchObject({ ok: true, state: "active" });
      }, {
        activationReadiness: () => ({ ready: true }),
      });
    } finally {
      db.close();
    }
  });

  it("blocks owner bootstrap when its provider readiness is false", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
          activationPath: "owner_bootstrap",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          ok: false,
          reason: "not_eligible",
          bootstrapReason: "provider_unavailable",
        });
      }, {
        activationReadiness: () => ({ ready: false, reason: "provider_unavailable" }),
      });
    } finally {
      db.close();
    }
  });

  it("rejects an unsupported activation path without changing release state", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
          activationPath: "unsupported_path",
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "message_required" });
        const row = db.prepare(
          `SELECT state FROM capability_releases WHERE capability = 'reading' AND release_id = ?`,
        ).get(currentContractId()) as { state: string };
        expect(row).toBeUndefined();
      }, {
        activationReadiness: () => ({ ready: true }),
      });
    } finally {
      db.close();
    }
  });

  it("promotes an eligible explicit-cutover capability for the owner without live_shadow", async () => {
    const db = makeDb();
    try {
      qualify(db, "recall");
      qualify(db, "mind_state");
      qualify(db, "thought");
      await withServer(db, async (app) => {
        const recallPromote = await post(app, "/nuclear/capabilities/promote", { userId: OWNER, capability: "recall" });
        const mindPromote = await post(app, "/nuclear/capabilities/promote", { userId: OWNER, capability: "mind_state" });
        const thoughtPromote = await post(app, "/nuclear/capabilities/promote", { userId: OWNER, capability: "thought" });
        expect(recallPromote.body).toMatchObject({ ok: true, state: "active" });
        expect(mindPromote.body).toMatchObject({ ok: true, state: "active" });
        expect(thoughtPromote.body).toMatchObject({ ok: true, state: "active" });

        recordIsolatedEvaluation(db, "project_experimentation", {
          seeds: 3,
          passed: true,
          sourceKey: "endpoint:cutover-eval",
          occurredAt: start.toISOString(),
        });
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "project_experimentation",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, state: "active" });
        const status = (res.body as { capabilities?: { capabilities?: Array<{ capability: string; state: string; liveShadowEvents: number }> } })
          .capabilities?.capabilities?.find((s) => s.capability === "project_experimentation");
        expect(status).toMatchObject({ state: "active", liveShadowEvents: 0 });
      });
    } finally {
      db.close();
    }
  });

  it("returns not_eligible for an ineligible explicit-cutover capability", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "project_experimentation",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: false, reason: "not_eligible" });
      });
    } finally {
      db.close();
    }
  });

  it("denies a non-owner", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: INTRUDER,
          capability: "reading",
        });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: "forbidden" });
      });
    } finally {
      db.close();
    }
  });

  it("errors on an unknown capability", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "no_such_capability",
        });
        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ code: "internal_error" });
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent for an already-active capability and fails closed for rolled-back state", async () => {
    const db = makeDb();
    try {
      qualify(db, "reading");
      await withServer(db, async (app) => {
        const first = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(first.body).toMatchObject({ ok: true, state: "active" });

        const again = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(again.body).toMatchObject({ ok: true, alreadyActive: true, state: "active" });

        db.prepare(
          `UPDATE capability_releases SET state = 'rolled_back', rolled_back_at = ?, updated_at = ?
           WHERE capability = 'reading' AND release_id = ?`,
        ).run(new Date().toISOString(), new Date().toISOString(), currentContractId());

        const rolled = await post(app, "/nuclear/capabilities/promote", {
          userId: OWNER,
          capability: "reading",
        });
        expect(rolled.body).toMatchObject({ ok: false, reason: "rolled_back" });
      });
    } finally {
      db.close();
    }
  });
});

describe("POST /nuclear/capabilities/evaluation (retired qualification route)", () => {
  it("records nothing: a request body can no longer qualify a capability (A13-7)", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/evaluation", {
          userId: OWNER,
          capability: "project_experimentation",
          seeds: 3,
          passed: true,
          sourceKey: "endpoint:qualification-retired",
        });
        expect(res.status).toBe(410);
        expect(res.body).toMatchObject({ code: "endpoint_retired" });
        const qualified = db.prepare(
          "SELECT COUNT(*) AS n FROM capability_releases WHERE qualified_at IS NOT NULL",
        ).get() as { n: number };
        expect(Number(qualified.n)).toBe(0);
      });
    } finally {
      db.close();
    }
  });
});
describe("C1 memory-evidence control-plane routes", () => {
  it("requires the Recall owner boundary on every dedicated route", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const deniedStart = await post(app, "/nuclear/capabilities/memory-evidence/qualification-epoch/start", {
          startRequestKey: "missing-owner",
          predecessorEpochId: null,
        });
        const deniedList = await get(app, "/nuclear/capabilities/memory-evidence/qualification-epochs");
        const deniedEvaluation = await post(app, "/nuclear/capabilities/memory-evidence/evaluation", {
          sourceKey: "missing-owner",
          definitionId: C1_EVALUATION_DEFINITION_ID,
          definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
          definitionHash: C1_EVALUATION_DEFINITION_HASH,
          seeds: [],
        });
        const deniedReadiness = await get(app, "/nuclear/capabilities/memory-evidence/readiness");
        const deniedCutover = await post(app, "/nuclear/capabilities/memory-evidence/cutover", {
          epochId: "missing-owner",
        });
        expect([
          deniedStart.status,
          deniedList.status,
          deniedEvaluation.status,
          deniedReadiness.status,
          deniedCutover.status,
        ]).toEqual([403, 403, 403, 403, 403]);
      });
    } finally {
      db.close();
    }
  });

  it("returns dedicated epoch/evaluation/readiness schemas and rejects generic C1 evaluation", async () => {
    const db = makeDb();
    try {
      qualify(db, "recall");
      expect(promoteCapability(db, "recall", {
        releaseId: currentContractId(),
        authorizedBy: OWNER,
      })).toMatchObject({ ok: true, state: "active" });
      expect(recordRecallLiveCutover(db, OWNER, {
        authorizedBy: OWNER,
        masterMode: "observe",
      })).toMatchObject({ success: true });
      await withServer(db, async (app) => {
        const generic = await post(app, "/nuclear/capabilities/evaluation", {
          userId: OWNER,
          capability: "memory_evidence",
          seeds: 6,
          passed: true,
          sourceKey: "generic-c1-evaluation",
        });
        // The generic evaluation POST is retired (A13-7); C1 evidence only comes
        // from the bound memory-evidence route below.
        expect(generic.status).toBe(410);
        expect(generic.body).toMatchObject({ code: "endpoint_retired" });

        const started = await post(app, "/nuclear/capabilities/memory-evidence/qualification-epoch/start", {
          userId: OWNER,
          startRequestKey: "endpoint-c1-start",
          predecessorEpochId: null,
        });
        expect(started.status).toBe(200);
        expect(started.body).toMatchObject({
          ok: true,
          created: true,
          currentQualificationEpoch: {
            ownerId: OWNER,
          },
          qualificationEpochs: expect.any(Array),
        });
        const epochId = (started.body as { epochId?: string }).epochId;
        expect(typeof epochId).toBe("string");

        const listed = await get(app, `/nuclear/capabilities/memory-evidence/qualification-epochs?userId=${encodeURIComponent(OWNER)}`);
        expect(listed.status).toBe(200);
        expect(listed.body).toMatchObject({
          current: { epochId },
          epochs: expect.arrayContaining([expect.objectContaining({ epochId })]),
        });

        const evaluation = await post(app, "/nuclear/capabilities/memory-evidence/evaluation", {
          userId: OWNER,
          sourceKey: `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:endpoint-route-run`,
          definitionId: C1_EVALUATION_DEFINITION_ID,
          definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
          definitionHash: C1_EVALUATION_DEFINITION_HASH,
          seeds: C1_REQUIRED_EVAL_SEEDS.map((id) => ({ id, passed: true })),
        });
        expect(evaluation.status).toBe(200);
        expect(evaluation.body).toMatchObject({
          recorded: true,
          currentQualificationEpoch: { epochId },
          readiness: { epochId },
        });

        const readiness = await get(app, `/nuclear/capabilities/memory-evidence/readiness?userId=${encodeURIComponent(OWNER)}`);
        expect(readiness.status).toBe(200);
        expect(readiness.body).toMatchObject({
          eligible: false,
          epochId,
          blockerCodes: expect.arrayContaining([
            "memory_evidence_not_active",
            "live_shadow_count_insufficient",
          ]),
          qualification: { epochId },
        });
      });
    } finally {
      db.close();
    }
  });

  it("requires trusted paused/quiescent state and ignores client quiescence fields", async () => {
    const db = makeDb();
    const originalMode = env.cognitionMode;
    env.cognitionMode = "observe";
    try {
      const epochId = prepareC1Epoch(db, "endpoint-cutover-start");
      seedC1Evidence(db, epochId);
      expect(promoteCapability(db, "memory_evidence", {
        releaseId: currentContractId(),
        authorizedBy: OWNER,
      })).toMatchObject({ ok: true, state: "active" });

      await withServer(db, async (app) => {
        const untrustedClientFlags = await post(app, "/nuclear/capabilities/memory-evidence/cutover", {
          userId: OWNER,
          epochId,
          paused: true,
          quiesced: true,
        });
        expect(untrustedClientFlags.status).toBe(200);
        expect(untrustedClientFlags.body).toMatchObject({
          ok: false,
          reason: "expression_plane_not_paused",
        });
        expect(db.prepare(
          "SELECT currentness_authority FROM memory_contract_state WHERE id = 1",
        ).get()).toMatchObject({ currentness_authority: "mem_facts" });

        const paused = await post(app, "/initiative/idle", { userId: OWNER });
        expect(paused.status).toBe(200);
      }, { state: "ready", expressionQuiesced: true });

      const tick = vi.fn(async () => ({ shouldSend: true }));
      await withServer(db, async (app) => {
        const paused = await post(app, "/initiative/idle", { userId: OWNER });
        expect(paused.status).toBe(503);
        expect(paused.body).toMatchObject({ code: "agent_not_ready" });
        expect(tick).not.toHaveBeenCalled();
      }, { state: "paused", expressionQuiesced: true, tick });
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("forwards the explicit owner-bootstrap path through readiness and cutover", async () => {
    const db = makeDb();
    const originalMode = env.cognitionMode;
    env.cognitionMode = "observe";
    try {
      const epochId = prepareC1Epoch(db, "endpoint-owner-bootstrap-cutover");
      seedOwnerBootstrapC1Evidence(db);
      expect(promoteCapability(db, "memory_evidence", {
        releaseId: currentContractId(),
        authorizedBy: OWNER,
        activationPath: "owner_bootstrap",
        readiness: { ready: true },
      })).toMatchObject({ ok: true, state: "active" });

      await withServer(db, async (app) => {
        const readiness = await get(app,
          `/nuclear/capabilities/memory-evidence/readiness?userId=${encodeURIComponent(OWNER)}&activationPath=owner_bootstrap`,
        );
        expect(readiness.status).toBe(200);
        expect(readiness.body).toMatchObject({
          eligible: true,
          epochId,
          activationPath: "owner_bootstrap",
        });

        const cutover = await post(app, "/nuclear/capabilities/memory-evidence/cutover", {
          userId: OWNER,
          epochId,
          activationPath: "owner_bootstrap",
        });
        expect(cutover.status).toBe(200);
        expect(cutover.body).toMatchObject({
          ok: true,
          epochId,
          markerBefore: { currentnessAuthority: "mem_facts" },
          markerAfter: { currentnessAuthority: "memory_assertions" },
        });
      }, { state: "paused", expressionQuiesced: true });
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("cuts over only after exact qualification and returns an idempotent sticky result", async () => {
    const db = makeDb();
    const originalMode = env.cognitionMode;
    env.cognitionMode = "observe";
    try {
      const epochId = prepareC1Epoch(db, "endpoint-cutover-success");
      seedC1Evidence(db, epochId);
      expect(promoteCapability(db, "memory_evidence", {
        releaseId: currentContractId(),
        authorizedBy: OWNER,
      })).toMatchObject({ ok: true, state: "active" });

      await withServer(db, async (app) => {
        const first = await post(app, "/nuclear/capabilities/memory-evidence/cutover", {
          userId: OWNER,
          epochId,
        });
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({
          ok: true,
          alreadyCutOver: false,
          epochId,
          markerBefore: { currentnessAuthority: "mem_facts" },
          markerAfter: { currentnessAuthority: "memory_assertions" },
          consistencyBefore: { ok: true },
          consistencyAfter: { ok: true },
          stickyRollbackDiagnostics: {
            reverseCutoverAvailable: false,
            barriersRemainEnforced: true,
          },
        });

        const retry = await post(app, "/nuclear/capabilities/memory-evidence/cutover", {
          userId: OWNER,
          epochId,
        });
        expect(retry.status).toBe(200);
        expect(retry.body).toMatchObject({
          ok: true,
          alreadyCutOver: true,
          markerBefore: { currentnessAuthority: "memory_assertions" },
          markerAfter: { currentnessAuthority: "memory_assertions" },
        });
      }, { state: "paused", expressionQuiesced: true });
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });
});

describe("POST /nuclear/capabilities/rollback (canonical rollback)", () => {
  it("rolls an active capability back through the canonical endpoint", async () => {
    const db = makeDb();
    try {
      qualify(db, "reading");
      await withServer(db, async (app) => {
        expect((await post(app, "/nuclear/capabilities/promote", { userId: OWNER, capability: "reading" })).body)
          .toMatchObject({ ok: true, state: "active" });
        const res = await post(app, "/nuclear/capabilities/rollback", {
          userId: OWNER,
          capability: "reading",
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, status: "rolled_back" });
        const audit = db.prepare(
          `SELECT COUNT(*) AS c FROM capability_events
           WHERE capability = 'reading' AND kind = 'operator_rollback'`,
        ).get() as { c: number };
        expect(audit.c).toBe(1);
      });
    } finally {
      db.close();
    }
  });

  it("denies a non-owner", async () => {
    const db = makeDb();
    try {
      await withServer(db, async (app) => {
        const res = await post(app, "/nuclear/capabilities/rollback", {
          userId: INTRUDER,
          capability: "reading",
        });
        expect(res.status).toBe(403);
      });
    } finally {
      db.close();
    }
  });
});

import { vi } from "vitest";
import { createHash } from "node:crypto";

const commandCodeState = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock("../../model-routing/adapters/command-code-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../model-routing/adapters/command-code-adapter.js")
  >();
  return {
    ...actual,
    createCommandCodeAdapter: () => ({
      provider: "command_code" as const,
      dispatch: commandCodeState.dispatch,
    }),
  };
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { completeChat, resetAdapterCache } from "../../../mistral-client.js";
import { openNuclearDb } from "../../db.js";
import type {
  CapabilityReality,
  IdentitySlice,
  KernelDeps,
  Observation,
  ThoughtInput,
} from "../types.js";
import { ORDINARY_THOUGHT_BUDGET_MS } from "../types.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { buildThoughtInput } from "./input.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { runThoughtModel } from "./run.js";
import { THOUGHT_MODEL_CIRCUIT_MS, thoughtModelCircuit } from "./model-circuit.js";
import { COMMAND_CODE_LIFEBOAT, COMMAND_CODE_POLICY, COMMAND_CODE_DOMUS_POLICY } from "../../command-code/policy.js";
import { buildProviderS5, openObservabilityStore } from "./diagnostics.js";

const constitution: IdentitySlice = {
  constitutional: ["truth first"],
  stableSelf: ["curious"],
};
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

const MUSE = COMMAND_CODE_POLICY.modelId;
const FLASH = COMMAND_CODE_LIFEBOAT.thought.modelId;
const FLASH_FAST = COMMAND_CODE_DOMUS_POLICY.modelId;
const savedCommandCodeKey = env.commandCodeApiKey;
const savedOfflineEnv = process.env.ASHLEY_PHASE0_OFFLINE;

function commandCodeText(
  text: string,
  usage: { promptTokens: number; completionTokens: number },
  providerModel: string,
) {
  return {
    text,
    providerModel,
    providerRequestId: "cc-lifeboat",
    providerHttpStatus: 200,
    providerRequestHash: "sha256:request",
    providerResponseHash: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
    usage,
    finishReason: "stop",
  };
}

function deps(
  attentionDb: DatabaseSync,
  observabilityDb?: DatabaseSync,
  nowMs: () => number = () => Date.now(),
): KernelDeps {
  return {
    nowMs,
    attentionDb,
    ...(observabilityDb ? { observabilityDb } : {}),
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
  };
}

function thoughtInput(cycleId: string, triggerKind: "owner_message" | "domus_notification"): ThoughtInput {
  const sidecar = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    cycleId,
    conversationId: `thread-${cycleId}`,
    triggerKind,
    triggerRef: `${cycleId}-ref`,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: cycle.conversationId,
    text: "hello",
    discordMessageIds: [`${cycleId}-message`],
    nowMs: 2,
  });
  appendInboxEvent(sidecar, {
    conversationId: cycle.conversationId,
    kind: triggerKind,
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" },
    createdAtMs: 2,
  });
  return buildThoughtInput({
    sidecar,
    cycle,
    triggerText: "hello",
    triggerEvidence: evidence,
    constitution,
    capabilityReality,
  });
}

afterEach(() => {
  thoughtModelCircuit.reset();
  commandCodeState.dispatch.mockReset();
  resetAdapterCache();
  env.commandCodeApiKey = savedCommandCodeKey;
  if (savedOfflineEnv === undefined) delete process.env.ASHLEY_PHASE0_OFFLINE;
  else process.env.ASHLEY_PHASE0_OFFLINE = savedOfflineEnv;
});

type DispatchSeen = { modelId: string; effort?: string; lifeboat?: boolean };

function arm(behavior: (call: number, args: { modelId: string; options: { reasoningEffort?: string; thoughtLifeboat?: boolean } }) => unknown) {
  const seen: DispatchSeen[] = [];
  commandCodeState.dispatch.mockImplementation(async (args: {
    modelId: string;
    options: { reasoningEffort?: string; thoughtLifeboat?: boolean };
  }) => {
    seen.push({ modelId: args.modelId, effort: args.options.reasoningEffort, lifeboat: args.options.thoughtLifeboat });
    return behavior(seen.length, args);
  });
  return seen;
}

async function pass(options: {
  cycleId: string;
  triggerKind?: "owner_message" | "domus_notification";
  deadlineAtMs?: number;
  disableThoughtTransportFailover?: boolean;
  observe?: boolean;
  nowMs?: () => number;
  beforeRedispatch?: () => boolean;
}) {
  delete process.env.ASHLEY_PHASE0_OFFLINE;
  env.commandCodeApiKey = "test-command-code-key";
  resetAdapterCache();
  const input = thoughtInput(options.cycleId, options.triggerKind ?? "owner_message");
  const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
  const store = options.observe ? openObservabilityStore(new DatabaseSync(":memory:")) : undefined;
  const invocation = await runThoughtModel(input, deps(attentionDb, store?.db, options.nowMs), {
    deadlineAtMs: options.deadlineAtMs ?? Date.now() + ORDINARY_THOUGHT_BUDGET_MS,
    ...(options.disableThoughtTransportFailover ? { disableThoughtTransportFailover: true } : {}),
    ...(options.beforeRedispatch ? { beforeRedispatch: options.beforeRedispatch } : {}),
  });
  return { invocation, store };
}

const ok = () => commandCodeText(JSON.stringify(makeSemanticSettlement()), { promptTokens: 1, completionTokens: 1 }, "");

describe("HA2 provider lifeboat", () => {
  it("sends a Muse pass to DeepSeek V4.1 Flash at max after a 503", async () => {
    const seen = arm((call, args) => {
      if (call === 1) throw new AppError("provider_unavailable", "command_code_http_503", 503);
      return { ...ok(), providerModel: args.modelId };
    });
    const { invocation, store } = await pass({ cycleId: "cycle-lifeboat-muse", observe: true });
    expect(seen).toEqual([
      { modelId: MUSE, effort: "xhigh", lifeboat: undefined },
      { modelId: FLASH, effort: "max", lifeboat: true },
    ]);
    expect(invocation.output.kind).not.toBe("failure");
    expect(invocation.lifeboat).toMatchObject({
      fromModelId: MUSE,
      toModelId: FLASH,
      toEffort: "max",
    });
    expect(invocation.lifeboat?.primaryFailureClass).toBeTruthy();
    expect(invocation.thoughtExecutionProvenance?.providerAttempts).toBe(2);
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(2);
    const row = store!.db.prepare(
      `SELECT code, fallback_attempt_ordinal FROM thought_dispatch_diagnostics WHERE cycle_id = ? AND code = 'provider_unavailable'`,
    ).get("cycle-lifeboat-muse") as { code: string; fallback_attempt_ordinal: number };
    expect(row).toMatchObject({ code: "provider_unavailable", fallback_attempt_ordinal: 2 });
  });

  it("sends a Domus pass to Muse at medium after a 503", async () => {
    const seen = arm((call, args) => {
      if (call === 1) throw new AppError("provider_unavailable", "command_code_http_503", 503);
      return { ...ok(), providerModel: args.modelId };
    });
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-domus", triggerKind: "domus_notification" });
    expect(seen[0]?.modelId).toBe(FLASH_FAST);
    expect(seen[1]).toMatchObject({ modelId: MUSE, effort: "medium", lifeboat: true });
    expect(invocation.lifeboat?.toModelId).toBe(MUSE);
  });

  it("treats 429 as a provider failure that launches the lifeboat", async () => {
    arm((call, args) => {
      if (call === 1) throw new AppError("rate_limited", "command_code_rate_limited", 429);
      return { ...ok(), providerModel: args.modelId };
    });
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-429" });
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(2);
    expect(invocation.lifeboat?.toModelId).toBe(FLASH);
  });

  it("does not dispatch a second model when the redispatch is no longer allowed", async () => {
    const seen = arm((call) => {
      if (call === 1) throw new AppError("provider_unavailable", "command_code_http_503", 503);
      return ok();
    });
    const { invocation } = await pass({
      cycleId: "cycle-lifeboat-stopped",
      beforeRedispatch: () => false,
    });
    expect(seen).toEqual([{ modelId: MUSE, effort: "xhigh", lifeboat: undefined }]);
    expect(invocation.ownerAnswerStopped).toBe(true);
    expect(invocation.lifeboat).toBeUndefined();
  });

  it("does not launch the lifeboat when the answer will not parse", async () => {
    arm((_call, args) => commandCodeText("not json", { promptTokens: 1, completionTokens: 1 }, args.modelId));
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-malformed" });
    expect(invocation.malformed).toBe(true);
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(1);
    expect(invocation.lifeboat).toBeUndefined();
  });

  it("does not launch the lifeboat on an invalid credential", async () => {
    arm(() => {
      throw new AppError("credential_invalid", "x", 401);
    });
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-credential" });
    expect(invocation.unavailable).toBe(true);
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not launch the lifeboat on a timeout", async () => {
    arm(() => {
      throw new AppError("timeout", "Thought provider deadline exceeded", 408);
    });
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-timeout" });
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(1);
    expect(invocation.unavailable).toBe(true);
  });

  it("does not launch the lifeboat when the deadline is too close", async () => {
    arm(() => {
      throw new AppError("provider_unavailable", "command_code_http_503", 503);
    });
    const { invocation } = await pass({
      cycleId: "cycle-lifeboat-deadline",
      deadlineAtMs: Date.now() + 10_000,
    });
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(1);
    expect(invocation.unavailable).toBe(true);
  });

  it("tries the lifeboat once when both models are unavailable", async () => {
    arm(() => {
      throw new AppError("provider_unavailable", "command_code_http_503", 503);
    });
    const { invocation } = await pass({ cycleId: "cycle-lifeboat-both" });
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(2);
    expect(invocation.unavailable).toBe(true);
    expect(invocation.lifeboat?.toModelId).toBe(FLASH);
  });

  it("stays on the pass model when transport failover is disabled", async () => {
    arm(() => {
      throw new AppError("provider_unavailable", "command_code_http_503", 503);
    });
    const { invocation } = await pass({
      cycleId: "cycle-lifeboat-guard",
      disableThoughtTransportFailover: true,
    });
    expect(commandCodeState.dispatch).toHaveBeenCalledTimes(1);
    expect(invocation.lifeboat).toBeUndefined();
  });

  it("skips a model that just failed and tries it again after ten minutes", async () => {
    let now = Date.now();
    let museFailures = 1;
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((message?: unknown) => {
      warns.push(String(message));
    });
    const seen = arm((_call, args) => {
      if (args.modelId === MUSE && museFailures > 0) {
        museFailures -= 1;
        throw new AppError("provider_unavailable", "command_code_http_503", 503);
      }
      return { ...ok(), providerModel: args.modelId };
    });
    try {
      const first = await pass({ cycleId: "cycle-circuit-open", nowMs: () => now });
      expect(seen.map((item) => item.modelId)).toEqual([MUSE, FLASH]);
      expect(first.invocation.lifeboat?.primaryFailureClass).not.toBe("circuit_open");
      expect(warns).toContain(`[thought] circuit open model=${MUSE} for=10m streak=1`);

      seen.length = 0;
      const second = await pass({ cycleId: "cycle-circuit-skip", nowMs: () => now, observe: true });
      expect(seen).toEqual([{ modelId: FLASH, effort: "max", lifeboat: true }]);
      expect(second.invocation.lifeboat).toMatchObject({
        fromModelId: MUSE,
        toModelId: FLASH,
        toEffort: "max",
        primaryFailureClass: "circuit_open",
        primaryDispatchTruth: "not_sent",
        primaryAttemptId: null,
        primaryProviderAttempts: 0,
      });
      expect(warns).toContain(`[thought] lifeboat from=${MUSE} class=circuit_open to=${FLASH} effort=max`);
      const row = second.store!.db.prepare(
        `SELECT code, provider_failure_json FROM thought_dispatch_diagnostics WHERE cycle_id = ? AND code = 'provider_unavailable'`,
      ).get("cycle-circuit-skip") as { code: string; provider_failure_json: string };
      expect(row.code).toBe("provider_unavailable");
      expect(row.provider_failure_json).toContain("circuit_open");

      now += THOUGHT_MODEL_CIRCUIT_MS;
      seen.length = 0;
      const third = await pass({ cycleId: "cycle-circuit-half-open", nowMs: () => now });
      expect(seen).toEqual([{ modelId: MUSE, effort: "xhigh", lifeboat: undefined }]);
      expect(third.invocation.lifeboat).toBeUndefined();
      expect(warns).toContain(`[thought] circuit closed model=${MUSE}`);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not open the circuit when the failure does not qualify", async () => {
    let now = Date.now();
    const seen = arm(() => {
      throw new AppError("timeout", "Thought provider deadline exceeded", 408);
    });
    await pass({ cycleId: "cycle-circuit-timeout-1", nowMs: () => now });
    expect(seen.map((item) => item.modelId)).toEqual([MUSE]);
    seen.length = 0;
    await pass({ cycleId: "cycle-circuit-timeout-2", nowMs: () => now });
    expect(seen[0]?.modelId).toBe(MUSE);
  });

  it("still dispatches an open model when that model is the lifeboat", async () => {
    let now = Date.now();
    let museFailures = 1;
    const seen = arm((_call, args) => {
      if (args.modelId === MUSE && museFailures > 0) {
        museFailures -= 1;
        throw new AppError("provider_unavailable", "command_code_http_503", 503);
      }
      if (args.modelId === FLASH_FAST) {
        throw new AppError("provider_unavailable", "command_code_http_503", 503);
      }
      return { ...ok(), providerModel: args.modelId };
    });
    await pass({ cycleId: "cycle-circuit-muse-down", nowMs: () => now });
    seen.length = 0;
    await pass({
      cycleId: "cycle-circuit-domus",
      triggerKind: "domus_notification",
      nowMs: () => now,
    });
    expect(seen.map((item) => item.modelId)).toEqual([FLASH_FAST, MUSE]);
    expect(seen[1]).toMatchObject({ modelId: MUSE, effort: "medium", lifeboat: true });
  });

  it("names the answering model on the provider diagnostic", () => {
    const s5 = buildProviderS5({
      providerModel: FLASH,
      dispatchTruth: "sent",
      parserStatus: "passed",
      validatorStatus: "passed",
      structuralRetryStatus: "not_applicable",
    });
    expect(s5?.modelId).toBe(FLASH);
  });
});
